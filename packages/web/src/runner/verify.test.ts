import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { Task } from "@agentq/shared";
import {
  TaskStatus,
  claimNextTask,
  createProject,
  createTask,
  getEvidence,
  getProjectById,
  getTaskById,
  setAppState,
  submitCode,
  submitReview,
  submitVerification,
  updateProject,
} from "@agentq/shared";
import { analyzeDiff, runVerification, VerifyWorker, verificationCommands, isAllowed } from "./verify.js";

process.env.AGENTQ_DB_PATH = ":memory:";
const HOME = mkdtempSync(join(tmpdir(), "agentq-verify-home-"));
const previousHome = process.env.AGENTQ_HOME;
process.env.AGENTQ_HOME = HOME;

const BUN = JSON.stringify(process.execPath);
const hasGit = !!Bun.which("git");
const root = mkdtempSync(join(tmpdir(), "agentq-verify-"));
const coder = { toolName: "Coder", version: "1", model: "m", sessionId: "verify-coder" };
const reviewer = { toolName: "Reviewer", version: "1", model: "r", sessionId: "verify-reviewer" };

function git(cwd: string, ...args: string[]) {
  const out = Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
  return out.stdout.toString().trim();
}

function write(dir: string, file: string, content: string) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

/** A repo on main with a test file, and a worktree on a feature branch. */
function makeRepo(): { repo: string; worktree: string } {
  const repo = join(root, randomUUID().slice(0, 8));
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  write(repo, "src/a.test.ts", "it('works', () => {});\n");
  write(repo, "src/a.ts", "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  const worktree = join(repo, ".agentq", "worktrees", "t");
  git(repo, "worktree", "add", "-q", "-b", "feat/x", worktree, "main");
  return { repo, worktree };
}

function commit(worktree: string, files: Record<string, string | null>) {
  for (const [file, content] of Object.entries(files)) {
    if (content === null) rmSync(join(worktree, file));
    else write(worktree, file, content);
  }
  git(worktree, "add", "-A");
  git(worktree, "commit", "-q", "-m", "change");
}

/** A project on the repo (L2 unless said otherwise) with the given commands. */
function project(repo: string, commands: Record<string, string>, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  createProject({ id, displayName: "Verify", workingDirectory: repo, profile: { commands, ...extra } as any });
  return id;
}

/** Codes a task in the worktree and submits it; returns the task in its next status. */
function coded(projectId: string, worktree: string, over: Partial<Parameters<typeof createTask>[0]> = {}): Task {
  const task = createTask({ title: "verify me", description: "d", projectId, ...over });
  const c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
  expect(c.task.id).toBe(task.id);
  setAppState("verifier_heartbeat", new Date().toISOString());
  const headSha = existsSync(worktree) ? git(worktree, "rev-parse", "HEAD") : undefined;
  submitCode(task.id, { message: "c", worktree, claimToken: c.claimToken, headSha });
  return getTaskById(task.id)!;
}

/** What the worker does: claim, run, report. */
async function verify(projectId: string, opts: Parameters<typeof runVerification>[2] = {}) {
  const claimed = claimNextTask({
    role: "verifier",
    agent: { toolName: "agentq-verifier", version: "1", model: "none", sessionId: "v" },
    projectId,
    runnerId: "builtin:verifier",
  })!;
  expect(claimed.task.status).toBe(TaskStatus.Verifying);
  const report = await runVerification(claimed.task, getProjectById(projectId), opts);
  submitVerification(claimed.task.id, { ...report, claimToken: claimed.claimToken });
  return getTaskById(claimed.task.id)!;
}

function recode(task: Task, worktree: string, files: Record<string, string | null> = {}) {
  if (Object.keys(files).length) commit(worktree, files);
  const c = claimNextTask({ role: "implementer", agent: coder, projectId: task.projectId! })!;
  expect(c.task.id).toBe(task.id);
  setAppState("verifier_heartbeat", new Date().toISOString());
  submitCode(task.id, { message: "again", worktree, claimToken: c.claimToken });
  return getTaskById(task.id)!;
}

beforeAll(() => {
  mkdirSync(root, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.AGENTQ_HOME;
  else process.env.AGENTQ_HOME = previousHome;
});

describe.skipIf(!hasGit)("verification", () => {
  it("green commands send the code to the AI review (L2), with evidence per command", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "console.log('12 pass')"` });
    commit(worktree, { "src/a.ts": "export const a = 2;\n" });
    expect(coded(pid, worktree).status).toBe(TaskStatus.VerifyRequested);
    const task = await verify(pid);
    expect(task.status).toBe(TaskStatus.CodeReviewRequested);
    expect(task.verification).toMatchObject({ passed: true, skipped: false, tampering: [] });
    expect(task.diffStats).toEqual({ files: 1, insertions: 1, deletions: 1 });
    const evidence = getEvidence(task.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ exitCode: 0, producedBy: "runner:verify", flaky: false });
    expect(evidence[0].summary).toContain("12 pass");
    expect(task.conversation.at(-1)).toMatchObject({ messageType: "verify", authorName: "verifier" });
  });

  it("under L0 a green verification goes to a person", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "0"` });
    updateProject(pid, { autonomy: 0 });
    coded(pid, worktree);
    expect((await verify(pid)).status).toBe(TaskStatus.WaitingCodeReview);
  });

  it("red goes back to the coder with the evidence; red twice asks a person", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "console.error('1 fail: empty list'); process.exit(1)"` });
    coded(pid, worktree);
    const first = await verify(pid);
    expect(first.status).toBe(TaskStatus.ChangesRequested);
    expect(first.verifyFailures).toBe(1);
    expect(getEvidence(first.id)[0]).toMatchObject({ exitCode: 1 });
    expect(getEvidence(first.id)[0].summary).toContain("1 fail: empty list");
    recode(first, worktree);
    const second = await verify(pid);
    expect(second.status).toBe(TaskStatus.NeedsHuman);
    expect(second.blocker?.reason).toContain("failed 2 times");
  });

  it("a command that fails once and then passes is marked flaky", async () => {
    const { repo, worktree } = makeRepo();
    const marker = join(root, `flaky-${randomUUID()}`);
    const script = `const f=${JSON.stringify(marker)}; if(!require('fs').existsSync(f)){require('fs').writeFileSync(f,'1');process.exit(1)}`;
    const pid = project(repo, { test: `${BUN} -e ${JSON.stringify(script)}` });
    coded(pid, worktree);
    const task = await verify(pid);
    expect(task.status).toBe(TaskStatus.CodeReviewRequested);
    expect(getEvidence(task.id)[0]).toMatchObject({ exitCode: 0, flaky: true });
  });

  it("a command that runs too long times out and fails", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "setTimeout(() => {}, 20000)"` });
    coded(pid, worktree);
    const task = await verify(pid, { timeoutMs: 500 });
    expect(task.status).toBe(TaskStatus.ChangesRequested);
    expect(getEvidence(task.id)[0].summary).toContain("Timed out");
  }, 15_000);

  it("skipped or deleted tests count as tampering: back to the coder, then to a person", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "0"` });
    commit(worktree, { "src/a.test.ts": "it.skip('works', () => {});\n" });
    coded(pid, worktree);
    const first = await verify(pid);
    expect(first.status).toBe(TaskStatus.ChangesRequested);
    expect(first.verification?.tampering[0]).toContain("skipped or focused test added in src/a.test.ts");
    recode(first, worktree, { "src/a.test.ts": null });
    const second = await verify(pid);
    expect(second.verification?.tampering.some((t) => t.includes("deleted test file src/a.test.ts"))).toBe(true);
    expect(second.status).toBe(TaskStatus.NeedsHuman);
    expect(second.blocker?.reason).toContain("Tests were weakened again");
  });

  it("detects lowered coverage thresholds", () => {
    const { worktree } = makeRepo();
    commit(worktree, { "vitest.config.ts": "export default { coverage: { lines: 90 } };\n" });
    git(worktree, "branch", "base", "HEAD");
    commit(worktree, { "vitest.config.ts": "export default { coverage: { lines: 50 } };\n" });
    expect(analyzeDiff(worktree, "base")!.tampering).toEqual(["coverage lines lowered from 90 to 50 in vitest.config.ts"]);
  });

  it("touching protected paths or a large diff raises the risk to high, so a person reviews", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "0"` }, { protectedPaths: ["migrations/**"], maxDiffLines: 10 });
    commit(worktree, { "migrations/001.sql": "create table x (id int);\n" });
    coded(pid, worktree);
    const verified = await verify(pid);
    expect(verified.risk).toBe("high");
    expect(verified.riskReasons[0]).toContain("migrations/001.sql");
    const r = claimNextTask({ role: "reviewer", agent: reviewer, projectId: pid })!;
    const out = submitReview(r.task.id, { verdict: "approve", message: "ok", claimToken: r.claimToken });
    expect(out.newStatus).toBe(TaskStatus.WaitingCodeReview);
  });

  it("runs the approved plan's commands per criterion; unapproved agent commands off the allowlist are skipped", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "0"` });
    const task = coded(pid, worktree, {
      acceptanceCriteria: [
        { text: "persists", verify: { kind: "command", command: `${BUN} -e "console.log('persisted')"` } },
        { text: "fast", verify: { kind: "command", command: "curl http://example.com" } },
      ],
    });
    const commands = verificationCommands(task, getProjectById(pid));
    expect(commands.map((c) => [c.source, c.criterionIds])).toEqual([
      ["project", []],
      ["plan", ["AC1"]],
      ["plan", ["AC2"]],
    ]);
    // A bun command is not on the default allowlist either, unless the project allows it.
    expect(isAllowed(commands[1], task, getProjectById(pid))).toBe(false);
    updateProject(pid, { profile: { verifyAllowlist: [BUN] } });
    const verified = await verify(pid);
    const evidence = getEvidence(verified.id);
    expect(evidence.find((e) => e.criterionId === "AC1")).toMatchObject({ exitCode: 0, skipped: false });
    expect(evidence.find((e) => e.criterionId === "AC2")).toMatchObject({ skipped: true });
    expect(verified.acceptanceCriteria.map((c) => [c.id, c.status])).toEqual([
      ["AC1", "met"],
      ["AC2", "pending"],
    ]);
  });

  it("without commands, or without a running verifier, the code goes straight to review", () => {
    const { repo, worktree } = makeRepo();
    const bare = project(repo, {});
    const task = coded(bare, worktree);
    expect(task.status).toBe(TaskStatus.CodeReviewRequested);
    expect(task.verification).toMatchObject({ skipped: true });
    expect(task.verification?.note).toContain("no commands");

    const withCommands = project(repo, { test: "bun test" });
    const t2 = createTask({ title: "offline", description: "d", projectId: withCommands });
    const c = claimNextTask({ role: "implementer", agent: coder, projectId: withCommands })!;
    setAppState("verifier_heartbeat", new Date(Date.now() - 10 * 60_000).toISOString());
    submitCode(t2.id, { message: "c", worktree, claimToken: c.claimToken });
    const offline = getTaskById(t2.id)!;
    expect(offline.status).toBe(TaskStatus.CodeReviewRequested);
    expect(offline.verification?.note).toContain("not running");
  });

  it("a missing worktree asks a person without counting a failure", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "0"` });
    coded(pid, join(worktree, "gone"));
    const task = await verify(pid);
    expect(task.status).toBe(TaskStatus.NeedsHuman);
    expect(task.verifyFailures).toBe(0);
    expect(task.blocker?.phase).toBe("verify");
  });

  it("the worker claims and verifies a task on its own", async () => {
    const { repo, worktree } = makeRepo();
    const pid = project(repo, { test: `${BUN} -e "0"` });
    const task = coded(pid, worktree);
    const worker = new VerifyWorker();
    // Earlier tests may have left other tasks waiting; the worker takes them one per tick.
    for (let i = 0; i < 10 && getTaskById(task.id)!.status === TaskStatus.VerifyRequested; i++) await worker.tick();
    worker.stop();
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.CodeReviewRequested);
  });
});
