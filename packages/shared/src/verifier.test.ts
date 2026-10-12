import { describe, it, expect, afterEach } from "bun:test";
import { createProject, createRunner, createTask, deleteRunner, getTaskById, patchTask, setAppState } from "./database.js";
import { BUILTIN_VERIFIER_AUTHOR, VERIFIER_RUNNER_ID, type Role } from "./catalog.js";
import { buildTaskBrief } from "./brief.js";
import { getEvidence } from "./records.js";
import { sweepQueue } from "./sweeper.js";
import { TaskStatus } from "./types.js";
import type { Task } from "./types.js";
import { resolvePolicy } from "./policy.js";
import { claimNextTask, submitCode, submitVerification, type SubmitCodeInput } from "./workflow.js";
import {
  VERIFY_WAIT_MIN,
  agentVerifierAvailable,
  markServerOffline,
  recordServerHeartbeat,
  serverOnline,
  verifierFor,
  verifierOnline,
  verifyWait,
} from "./verifier.js";

process.env.MOONLIGHTQ_DB_PATH = ":memory:";

const minutes = (n: number) => n * 60_000;
const coder = { toolName: "Coder", version: "1", model: "sonnet", sessionId: "v-coder" };
const verifier = { toolName: "Verifier", version: "1", model: "opus", sessionId: "v-verifier" };
const builtin = { toolName: "moonlightq-verifier", version: "1", model: "none", sessionId: VERIFIER_RUNNER_ID };

const runnerIds: string[] = [];
let projects = 0;

afterEach(() => {
  for (const id of runnerIds.splice(0)) deleteRunner(id);
  // The beats are global state: leave both verifiers offline for the next test.
  setAppState("verifier_heartbeat", new Date(0).toISOString());
  markServerOffline();
});

/** An enabled runner; `model` defaults to its own so separate runners are on separate models. */
function runner(roles: Role[], over: Partial<Parameters<typeof createRunner>[0]> = {}) {
  const r = createRunner({ name: `runner-${runnerIds.length}`, tool: "claude", roles, enabled: true, model: `model-${runnerIds.length}`, ...over });
  runnerIds.push(r.id);
  return r;
}

/** A project of its own, so a claim can only return this test's tasks. */
function project(policy: Parameters<typeof createProject>[0]["policy"] = {}, commands: Record<string, string> = {}) {
  const id = `verifier-${Date.now()}-${projects++}`;
  createProject({ id, displayName: "Verifier", workingDirectory: "/tmp/verifier", policy, profile: { commands } });
  return id;
}

/** A task the coder just submitted: where it goes depends on who can verify it. */
function submitted(projectId: string, by: { runner?: ReturnType<typeof runner>; evidence?: SubmitCodeInput["evidence"] } = {}): Task {
  const task = createTask({ title: "verify me", description: "d", projectId });
  const claimed = claimNextTask(
    by.runner
      ? { roles: ["code"], agent: { toolName: by.runner.tool, version: "1", model: by.runner.model ?? "default", sessionId: "r" }, runnerId: by.runner.id, projectId }
      : { roles: ["code"], agent: coder, projectId },
  )!;
  expect(claimed.task.id).toBe(task.id);
  submitCode(task.id, { message: "c", worktree: "/w", claimToken: claimed.claimToken, evidence: by.evidence });
  return getTaskById(task.id)!;
}

describe("the heartbeats", () => {
  it("the web server counts as running for three minutes after its last beat, and not after it went down", () => {
    const now = Date.now();
    markServerOffline();
    expect(serverOnline(now)).toBe(false);
    recordServerHeartbeat(new Date(now));
    expect([serverOnline(now), serverOnline(now + minutes(2)), serverOnline(now + minutes(4))]).toEqual([true, true, false]);
    markServerOffline();
    expect(serverOnline(now)).toBe(false);
  });

  it("the built-in verifier counts as running for two minutes after its last beat", () => {
    const now = Date.now();
    setAppState("verifier_heartbeat", new Date(now).toISOString());
    expect([verifierOnline(now), verifierOnline(now + minutes(1)), verifierOnline(now + minutes(3))]).toEqual([true, true, false]);
  });
});

describe("which runners can verify", () => {
  const policy = { requireDifferentModel: false };

  it("needs the server up and an enabled runner with the verify role on the project, other than the code's author", () => {
    const projectId = project();
    recordServerHeartbeat();
    const task = submitted(projectId);
    expect(agentVerifierAvailable(task, policy)).toBe(false);

    runner(["review", "code"]);
    runner(["verify"], { enabled: false });
    runner(["verify"], { projectId: "another-project" });
    expect(agentVerifierAvailable(task, policy)).toBe(false);

    const elsewhere = runner(["verify"], { projectId });
    expect(agentVerifierAvailable(task, policy)).toBe(true);
    // The runners run inside the web server: without it none of them is going to take the task.
    markServerOffline();
    expect(agentVerifierAvailable(task, policy)).toBe(false);
    recordServerHeartbeat();
    deleteRunner(elsewhere.id);
    runnerIds.splice(runnerIds.indexOf(elsewhere.id), 1);
    runner(["verify"]);
    expect(agentVerifierAvailable(task, policy)).toBe(true);
  });

  it("the runner that wrote the code is not one of them; under requireDifferentModel, nor is one on its model", () => {
    const projectId = project();
    recordServerHeartbeat();
    const author = runner(["code", "verify"], { model: "sonnet" });
    const task = submitted(projectId, { runner: author });
    expect(task.producers.code?.identities).toContain(`runner:${author.id}`);
    expect(agentVerifierAvailable(task, policy)).toBe(false);

    const sameModel = runner(["verify"], { model: "claude-sonnet-4-5" });
    expect(agentVerifierAvailable(task, policy)).toBe(true);
    expect(agentVerifierAvailable(task, { requireDifferentModel: true })).toBe(false);
    runner(["verify"], { model: "opus" });
    expect(agentVerifierAvailable(task, { requireDifferentModel: true })).toBe(true);
    expect(sameModel.roles).toEqual(["verify"]);
  });
});

describe("who verifies code", () => {
  const base = { requireDifferentModel: false };
  const task = () => {
    recordServerHeartbeat();
    return submitted(project());
  };

  it("a project set to agent always waits for an agent, with or without commands and whatever the built-in verifier does", () => {
    const t = task();
    const agent = { ...base, verifier: "agent" as const };
    expect([true, false].map((commands) => verifierFor(t, agent, commands))).toEqual(["agent", "agent"]);
    setAppState("verifier_heartbeat", new Date().toISOString());
    expect(verifierFor(t, agent, true)).toBe("agent");
  });

  it("otherwise the built-in verifier, when there are commands and it is running; else a runner that can take over; else nobody", () => {
    const t = task();
    const builtinMode = { ...base, verifier: "builtin" as const };
    expect(verifierFor(t, builtinMode, true)).toBeNull();
    setAppState("verifier_heartbeat", new Date().toISOString());
    expect(verifierFor(t, builtinMode, true)).toBe("builtin");
    // Nothing to run: there is nothing to verify, however many verifiers are up.
    expect(verifierFor(t, builtinMode, false)).toBeNull();

    setAppState("verifier_heartbeat", new Date(0).toISOString());
    runner(["verify"]);
    expect(verifierFor(t, builtinMode, true)).toBe("agent");
    expect(verifierFor(t, builtinMode, false)).toBeNull();
    markServerOffline();
    expect(verifierFor(t, builtinMode, true)).toBeNull();
  });
});

describe("how long code waits for its verifier", () => {
  const prepare = (policy: Parameters<typeof project>[0] = {}) => {
    recordServerHeartbeat();
    const projectId = project(policy);
    return { task: submitted(projectId), policy: resolvePolicy({ policy }) };
  };

  it("an agent verifier waits as long as a review does (reviewStarvationMin), or forever at 0", () => {
    const { task, policy } = prepare({ verifier: "agent" });
    expect(verifyWait(task, policy)).toEqual({ minutes: 20, by: "agent" });
    expect(verifyWait(task, { ...policy, reviewStarvationMin: 45 })).toEqual({ minutes: 45, by: "agent" });
    expect(verifyWait(task, { ...policy, reviewStarvationMin: 0 })).toBeNull();
  });

  it("the built-in verifier never times out while it beats, and gets a few minutes once it stopped", () => {
    const { task, policy } = prepare();
    setAppState("verifier_heartbeat", new Date().toISOString());
    expect(verifyWait(task, policy)).toBeNull();
    setAppState("verifier_heartbeat", new Date(0).toISOString());
    expect(verifyWait(task, policy)).toEqual({ minutes: VERIFY_WAIT_MIN, by: "builtin" });
  });

  it("a runner that can take over, while the built-in verifier is away, is waited for like an agent verifier", () => {
    const { task, policy } = prepare();
    runner(["verify"]);
    expect(verifyWait(task, policy)).toEqual({ minutes: 20, by: "agent" });
    expect(verifyWait(task, { ...policy, reviewStarvationMin: 0 })).toBeNull();
    // Once the server is gone too, nobody is coming.
    expect(verifyWait(task, policy, Date.now() + minutes(10))).toEqual({ minutes: VERIFY_WAIT_MIN, by: "builtin" });
  });
});

describe("a project that verifies with an agent", () => {
  it("sends code to verify_requested with no commands and no built-in verifier, which leaves it to agents", () => {
    const projectId = project({ verifier: "agent" });
    const task = submitted(projectId);
    expect(task.status).toBe(TaskStatus.VerifyRequested);
    expect(task.verification).toMatchObject({ passed: false, skipped: true });
    expect(task.verification?.note).toContain("verifier agent");

    // Not even with its heartbeat fresh: the built-in verifier does not claim it.
    setAppState("verifier_heartbeat", new Date().toISOString());
    expect(claimNextTask({ roles: ["verify"], agent: builtin, runnerId: VERIFIER_RUNNER_ID, projectId })).toBeNull();
    const claimed = claimNextTask({ roles: ["verify"], agent: verifier, projectId })!;
    expect(claimed.task.id).toBe(task.id);
    expect(claimed.task.status).toBe(TaskStatus.Verifying);
  });

  it("does not change how the others are verified: the built-in verifier claims a project set to builtin", () => {
    const agentProject = project({ verifier: "agent" });
    const builtinProject = project({}, { test: "bun test" });
    setAppState("verifier_heartbeat", new Date().toISOString());
    const waiting = submitted(builtinProject);
    expect(waiting.status).toBe(TaskStatus.VerifyRequested);
    expect(waiting.verification?.note).toBe("Waiting for the verifier.");
    submitted(agentProject);

    expect(claimNextTask({ roles: ["verify"], agent: builtin, runnerId: VERIFIER_RUNNER_ID, projectId: agentProject })).toBeNull();
    const claimed = claimNextTask({ roles: ["verify"], agent: builtin, runnerId: VERIFIER_RUNNER_ID, projectId: builtinProject })!;
    expect(claimed.task.id).toBe(waiting.id);
  });

  it("keeps separation of duties: the coder, and under requireDifferentModel its model, never verify its code", () => {
    const projectId = project({ verifier: "agent", requireDifferentModel: true });
    const task = submitted(projectId);
    // The same conversation, with the verify role too.
    expect(claimNextTask({ roles: ["code", "verify"], agent: coder, projectId })).toBeNull();
    // Another session on the coder's model (any spelling of it).
    expect(claimNextTask({ roles: ["verify"], agent: { ...verifier, model: "claude-sonnet-4-5" }, projectId })).toBeNull();
    expect(claimNextTask({ roles: ["verify"], agent: verifier, projectId })!.task.id).toBe(task.id);
  });

  it("keeps it for runners too: a runner with code and verify does not verify what it coded", () => {
    const projectId = project({ verifier: "agent" });
    const author = runner(["code", "verify"]);
    const task = submitted(projectId, { runner: author });
    const claim = (r: ReturnType<typeof runner>) =>
      claimNextTask({ roles: r.roles, agent: { toolName: r.tool, version: "1", model: r.model ?? "default", sessionId: "s" }, runnerId: r.id, projectId });
    expect(claim(author)).toBeNull();
    expect(claim(runner(["verify"], { model: author.model }))!.task.id).toBe(task.id);
  });

  it("is told so when nobody takes the code: the sweeper waits reviewStarvationMin, not the built-in verifier's few minutes", () => {
    const projectId = project({ verifier: "agent" });
    const task = submitted(projectId);
    expect(sweepQueue(new Date(Date.now() + minutes(VERIFY_WAIT_MIN + 1))).unverified).not.toContain(task.id);
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.VerifyRequested);

    expect(sweepQueue(new Date(Date.now() + minutes(21))).unverified).toContain(task.id);
    const swept = getTaskById(task.id)!;
    expect(swept.status).toBe(TaskStatus.CodeReviewRequested);
    expect(swept.verification).toMatchObject({ passed: false, skipped: true });
    expect(swept.verification?.note).toContain("no verifier agent");
    expect(swept.conversation.at(-1)!.message).toContain("`verify` role");
    expect(swept.history.at(-1)!.actor).toBe("system:sweeper");
  });

  it("waits for ever with reviewStarvationMin 0, like a review", () => {
    const projectId = project({ verifier: "agent", reviewStarvationMin: 0 });
    const task = submitted(projectId);
    expect(sweepQueue(new Date(Date.now() + minutes(24 * 60))).unverified).not.toContain(task.id);
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.VerifyRequested);
  });
});

describe("a runner that takes over from the built-in verifier", () => {
  it("receives the code while the server runs it, with commands to run", () => {
    const projectId = project({}, { test: "bun test" });
    recordServerHeartbeat();
    runner(["verify"]);
    const task = submitted(projectId);
    expect(task.status).toBe(TaskStatus.VerifyRequested);
    expect(task.verification?.note).toContain("verifier agent");
  });

  it("is not counted on without the server, for the code it wrote, or when there is nothing to run", () => {
    const withCommands = project({}, { test: "bun test" });
    const author = runner(["code", "verify"]);
    recordServerHeartbeat();
    // The only runner that could verify it wrote it: the code goes to review, not verified.
    const own = submitted(withCommands, { runner: author });
    expect(own.status).toBe(TaskStatus.CodeReviewRequested);
    expect(own.verification?.note).toContain("no runner with the verify role can take over");

    runner(["verify"]);
    markServerOffline();
    expect(submitted(withCommands).status).toBe(TaskStatus.CodeReviewRequested);

    recordServerHeartbeat();
    expect(submitted(project()).status).toBe(TaskStatus.CodeReviewRequested);
  });

  it("the sweeper keeps the code for it for reviewStarvationMin, when the built-in verifier stopped", () => {
    const projectId = project({}, { test: "bun test" });
    recordServerHeartbeat();
    runner(["verify"]);
    const task = submitted(projectId);
    const at = (min: number) => {
      const later = new Date(Date.now() + minutes(min));
      recordServerHeartbeat(new Date(later.getTime() - 30_000));
      return later;
    };
    expect(sweepQueue(at(VERIFY_WAIT_MIN + 1)).unverified).not.toContain(task.id);
    expect(sweepQueue(at(21)).unverified).toContain(task.id);
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.CodeReviewRequested);
  });

  it("the sweeper still gives up after a few minutes when it is the built-in verifier that is expected and it is gone", () => {
    const projectId = project({}, { test: "bun test" });
    setAppState("verifier_heartbeat", new Date().toISOString());
    const task = submitted(projectId);
    expect(task.status).toBe(TaskStatus.VerifyRequested);
    // While it beats, it may take all the time it needs.
    const later = new Date(Date.now() + minutes(VERIFY_WAIT_MIN + 1));
    setAppState("verifier_heartbeat", later.toISOString());
    expect(sweepQueue(later).unverified).not.toContain(task.id);
    setAppState("verifier_heartbeat", new Date(0).toISOString());
    expect(sweepQueue(later).unverified).toContain(task.id);
    expect(getTaskById(task.id)!.verification?.note).toContain("verifier is not running");
  });
});

describe("evidence of an agent verifier", () => {
  const red = [{ kind: "command" as const, command: "bun test", exitCode: 1, summary: "1 fail" }];

  it("carries the agent's id, never the built-in verifier's; the brief still lists its failing commands", () => {
    const projectId = project({ verifier: "agent" });
    const task = submitted(projectId, { evidence: [{ kind: "command", command: "bun run lint", exitCode: 1, summary: "the coder's own" }] });
    const v = claimNextTask({ roles: ["verify"], agent: verifier, projectId })!;
    // Passing itself off as the built-in verifier does not make the evidence its own.
    submitVerification(task.id, { passed: false, evidence: red, author: BUILTIN_VERIFIER_AUTHOR, claimToken: v.claimToken });

    const verifying = getTaskById(task.id)!;
    const rows = getEvidence(task.id).filter((e) => verifying.verification?.evidenceIds?.includes(e.id));
    expect(rows.map((e) => e.producedBy)).toEqual([v.agent.id]);
    expect(v.agent.id).toBe("verifier@1|opus");
    expect(verifying.producers.verify?.agentId).toBe(v.agent.id);
    expect(buildTaskBrief(task.id)!.verification!.failing).toEqual([{ command: "bun test", exitCode: 1, summary: "1 fail" }]);
  });

  it("is the server's own only for the built-in verifier, which is told apart by its claim", () => {
    const projectId = project({}, { test: "bun test" });
    setAppState("verifier_heartbeat", new Date().toISOString());
    const task = submitted(projectId);
    const v = claimNextTask({ roles: ["verify"], agent: builtin, runnerId: VERIFIER_RUNNER_ID, projectId })!;
    // The report does not name an author: the claim does the telling.
    submitVerification(task.id, { passed: false, evidence: red, claimToken: v.claimToken });
    expect(getEvidence(task.id).map((e) => e.producedBy)).toEqual([BUILTIN_VERIFIER_AUTHOR]);
    expect(buildTaskBrief(task.id)!.verification!.failing).toHaveLength(1);
  });

  it("older records, which list no evidence ids, still show the built-in verifier's rows and only those", () => {
    const projectId = project({}, { test: "bun test" });
    setAppState("verifier_heartbeat", new Date().toISOString());
    const task = submitted(projectId, { evidence: [{ kind: "command", command: "bun run lint", exitCode: 1, summary: "the coder's own" }] });
    const v = claimNextTask({ roles: ["verify"], agent: builtin, runnerId: VERIFIER_RUNNER_ID, projectId })!;
    submitVerification(task.id, { passed: false, evidence: red, claimToken: v.claimToken });
    const legacy = { ...getTaskById(task.id)!.verification! };
    delete legacy.evidenceIds;
    patchTask(task.id, { verification: legacy });
    expect(buildTaskBrief(task.id)!.verification!.failing).toEqual([{ command: "bun test", exitCode: 1, summary: "1 fail" }]);
  });
});
