import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import type { Runner } from "@agentq/shared";
import {
  TaskStatus,
  createProject,
  createRunner,
  createTask,
  deleteRunner,
  getTaskById,
  getTasks,
  getActivityEvents,
  resetDb,
  revertClaim,
  updateTask,
} from "@agentq/shared";
import { RunnerEngine, type RunnerJob } from "./runner.js";
import { buildCommand } from "./commands.js";
import { stripFrontmatter } from "./prompt.js";

// The engine claims in-process while the spawned CLI opens the database by
// path, so this file needs a FILE database. Other test files may already have
// opened the singleton on ":memory:"; resetDb() reopens it on our path.
const DB_PATH = join(tmpdir(), `agentq-runner-test-${randomUUID()}.db`);
const HOME = join(tmpdir(), `agentq-runner-home-${randomUUID()}`);
const PROJECT_DIR = join(tmpdir(), `agentq-runner-project-${randomUUID()}`);
const CLI = resolve(import.meta.dir, "../../../cli/src/index.ts");

const previousDbPath = process.env.AGENTQ_DB_PATH;
const previousHome = process.env.AGENTQ_HOME;
process.env.AGENTQ_DB_PATH = DB_PATH;
process.env.AGENTQ_HOME = HOME;
resetDb();

const projectId = randomUUID();
const events: { event: string; data: any }[] = [];
const engines: RunnerEngine[] = [];
const runners: Runner[] = [];

function makeEngine(opts: ConstructorParameters<typeof RunnerEngine>[0] = {}) {
  const engine = new RunnerEngine({
    broadcast: (event, data) => events.push({ event, data }),
    killGraceMs: 2000,
    ...opts,
  });
  engines.push(engine);
  return engine;
}

function makeRunner(argv: string[], overrides: Partial<Parameters<typeof createRunner>[0]> = {}) {
  const runner = createRunner({
    name: `test-${randomUUID().slice(0, 8)}`,
    tool: "custom",
    role: "planner",
    projectId,
    pollIntervalSec: 1,
    extraArgs: argv,
    ...overrides,
  });
  runners.push(runner);
  return runner;
}

function planTask(title: string) {
  return createTask({ title, description: "runner test", projectId, requiresPlan: true });
}

async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs = 20_000, label = "condition"): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

function lastJob(engine: RunnerEngine, runnerId: string) {
  return engine.getJobs(runnerId)[0] as Omit<RunnerJob, "tail"> | undefined;
}

beforeAll(() => {
  mkdirSync(PROJECT_DIR, { recursive: true });
  createProject({ id: projectId, displayName: "Runner Project", workingDirectory: PROJECT_DIR });
});

afterEach(async () => {
  for (const engine of engines) await engine.shutdown();
  engines.length = 0;
  for (const runner of runners) deleteRunner(runner.id);
  runners.length = 0;
  events.length = 0;
  // Park leftover tasks so the next test's runner cannot claim them.
  for (const task of getTasks(projectId)) {
    if (task.status !== TaskStatus.Canceled) {
      updateTask(task.id, { status: TaskStatus.Canceled, assignedAgent: null });
    }
  }
});

afterAll(() => {
  // Hand the singleton back to the in-memory DB the other test files expect.
  process.env.AGENTQ_DB_PATH = previousDbPath ?? ":memory:";
  if (previousHome === undefined) delete process.env.AGENTQ_HOME;
  else process.env.AGENTQ_HOME = previousHome;
  resetDb();
  for (const p of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    try { rmSync(p); } catch {}
  }
  rmSync(HOME, { recursive: true, force: true });
  rmSync(PROJECT_DIR, { recursive: true, force: true });
});

describe("RunnerEngine", () => {
  it("claims a task, runs the tool, and marks the job succeeded when the agent submits", async () => {
    const task = planTask("submits a plan");
    const runner = makeRunner([
      "bash",
      "-c",
      `bun run "${CLI}" submit-plan "$AGENTQ_TASK_ID" --json -m "## Plan" && echo "prompt file: $AGENTQ_PROMPT_FILE"`,
    ]);
    const engine = makeEngine();
    engine.start(runner.id);
    expect(engine.getState(runner.id).running).toBe(true);

    const job = await waitFor(() => {
      const j = lastJob(engine, runner.id);
      return j && j.status !== "running" ? j : null;
    }, 20_000, "job to finish");

    expect(job.status).toBe("succeeded");
    expect(job.exitCode).toBe(0);
    expect(job.taskId).toBe(task.id);
    expect(job.phase).toBe("plan");

    const updated = getTaskById(task.id)!;
    expect(updated.status).toBe(TaskStatus.WaitingPlanReview);
    expect(updated.assignedAgent).toBeNull();
    expect(updated.conversation.some((c) => c.message === "## Plan")).toBe(true);
    expect(updated.contexts).toContain(`Claimed by runner ${runner.name}`);

    // Log + prompt files live under AGENTQ_HOME/runs/<taskId>/.
    expect(existsSync(job.logPath)).toBe(true);
    const log = readFileSync(job.logPath, "utf8");
    expect(log).toContain("prompt file:");
    const promptFile = join(HOME, "runs", task.id, `${job.id}.prompt.md`);
    expect(existsSync(promptFile)).toBe(true);
    const prompt = readFileSync(promptFile, "utf8");
    expect(prompt).toContain(task.id);
    expect(prompt).toContain("Do **NOT** run `agentq claim`");
    expect(prompt).toContain(`agentq submit-plan ${task.id}`);
    expect(prompt).not.toContain("allowed-tools:");

    const kinds = events.filter((e) => e.event === "runner_job").map((e) => e.data.type);
    expect(kinds[0]).toBe("started");
    expect(kinds).toContain("output");
    expect(kinds[kinds.length - 1]).toBe("finished");
    expect(events.some((e) => e.event === "task_updated" && e.data.id === task.id)).toBe(true);
    expect(engine.readLog(engine.getJob(runner.id, job.id)!, 5)).toContain("job succeeded");
  });

  it("reverts the task when the tool exits without submitting", async () => {
    const task = planTask("exits early");
    const runner = makeRunner(["bash", "-c", "echo boom >&2; exit 3"]);
    const engine = makeEngine();
    engine.start(runner.id);

    const job = await waitFor(() => {
      const j = lastJob(engine, runner.id);
      return j && j.status !== "running" ? j : null;
    }, 20_000, "job to finish");

    expect(job.status).toBe("reverted");
    expect(job.exitCode).toBe(3);

    const updated = getTaskById(task.id)!;
    expect(updated.status).toBe(TaskStatus.PlanRequested);
    expect(updated.assignedAgent).toBeNull();
    const system = updated.conversation.filter((c) => c.messageType === "system");
    expect(system).toHaveLength(1);
    expect(system[0].authorName).toBe("system");
    expect(system[0].message).toContain(`Runner ${runner.name}: custom exited with code 3 without submitting`);
    expect(system[0].message).toContain("boom");
    expect(updated.history[updated.history.length - 1]).toMatchObject({
      pre_status: TaskStatus.Planning,
      new_status: TaskStatus.PlanRequested,
    });
    const activity = getActivityEvents({ taskId: task.id });
    expect(activity.some((a) => a.eventType === "task_reverted" && a.actor === "runner")).toBe(true);
  });

  it("backs off before re-claiming a reverted task, then retries", async () => {
    const task = planTask("retry after backoff");
    const runner = makeRunner(["bash", "-c", "exit 1"]);
    const engine = makeEngine({ revertBackoffMs: 1500 });
    engine.start(runner.id);

    await waitFor(() => engine.getJobs(runner.id).length === 1 && lastJob(engine, runner.id)!.status === "reverted", 10_000, "first revert");
    const cooldown = engine.getCooldowns().find((c) => c.taskId === task.id)!;
    expect(cooldown.count).toBe(1);
    await Bun.sleep(700);
    expect(engine.getJobs(runner.id)).toHaveLength(1);
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.PlanRequested);

    await waitFor(() => engine.getJobs(runner.id).length === 2, 10_000, "retry after cooldown");
    await waitFor(() => lastJob(engine, runner.id)!.status === "reverted", 10_000, "second revert");
    expect(engine.getCooldowns().find((c) => c.taskId === task.id)!.count).toBe(2);
  });

  it("respects concurrency: the second task waits for the first job to end", async () => {
    const first = planTask("concurrency 1");
    const second = planTask("concurrency 2");
    const runner = makeRunner(
      ["bash", "-c", `sleep 1.5; bun run "${CLI}" submit-plan "$AGENTQ_TASK_ID" --json -m "## Plan"`],
      { concurrency: 1 },
    );
    const engine = makeEngine();
    engine.start(runner.id);

    await waitFor(() => engine.getState(runner.id).activeJobs === 1, 5000, "first job to start");
    await Bun.sleep(300);
    const statuses = [getTaskById(first.id)!.status, getTaskById(second.id)!.status].sort();
    expect(statuses).toEqual([TaskStatus.PlanRequested, TaskStatus.Planning].sort());
    expect(engine.getState(runner.id).activeJobs).toBe(1);

    await waitFor(
      () =>
        getTaskById(first.id)!.status === TaskStatus.WaitingPlanReview &&
        getTaskById(second.id)!.status === TaskStatus.WaitingPlanReview,
      30_000,
      "both tasks to be submitted",
    );
    const jobs = await waitFor(() => {
      const all = engine.getJobs(runner.id);
      return all.length === 2 && all.every((j) => j.status !== "running") ? all : null;
    }, 10_000, "both jobs to finish");
    expect(jobs.every((j) => j.status === "succeeded")).toBe(true);
    // Sequential: the second job started after the first finished.
    const [later, earlier] = jobs;
    expect(new Date(later.startedAt).getTime()).toBeGreaterThanOrEqual(new Date(earlier.finishedAt!).getTime());
  });

  it("stop() kills running jobs and reverts their tasks", async () => {
    const task = planTask("long running");
    const runner = makeRunner(["bash", "-c", "sleep 30"]);
    const engine = makeEngine();
    engine.start(runner.id);

    await waitFor(() => engine.getState(runner.id).activeJobs === 1, 5000, "job to start");
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.Planning);

    const started = Date.now();
    const state = await engine.stop(runner.id);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(engine.getCooldowns().map((c) => c.taskId)).toContain(task.id);
    expect(state.running).toBe(false);
    expect(state.activeJobs).toBe(0);

    const job = lastJob(engine, runner.id)!;
    expect(job.status).toBe("reverted");
    const updated = getTaskById(task.id)!;
    expect(updated.status).toBe(TaskStatus.PlanRequested);
    expect(updated.assignedAgent).toBeNull();
    expect(updated.conversation.at(-1)?.message).toContain("Runner stopped");
  });

  it("times out jobs that exceed the limit", async () => {
    const task = planTask("times out");
    const runner = makeRunner(["bash", "-c", "sleep 30"]);
    const engine = makeEngine({ jobTimeoutMs: 500 });
    engine.start(runner.id);

    const job = await waitFor(() => {
      const j = lastJob(engine, runner.id);
      return j && j.status !== "running" ? j : null;
    }, 10_000, "job to time out");
    expect(job.status).toBe("reverted");
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.PlanRequested);
    expect(getTaskById(task.id)!.conversation.at(-1)?.message).toContain("timed out");
  });

  it("reverts and fails the job when the project directory is missing", async () => {
    const missingProject = randomUUID();
    createProject({ id: missingProject, displayName: "Missing", workingDirectory: join(tmpdir(), `nope-${randomUUID()}`) });
    const task = createTask({ title: "no dir", description: "", projectId: missingProject, requiresPlan: true });
    const runner = makeRunner(["bash", "-c", "true"], { projectId: missingProject });
    const engine = makeEngine();
    engine.start(runner.id);

    const job = await waitFor(() => {
      const j = lastJob(engine, runner.id);
      return j && j.status !== "running" ? j : null;
    }, 10_000, "job to finish");
    expect(job.status).toBe("reverted");
    expect(job.pid).toBeNull();
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.PlanRequested);
    expect(getTaskById(task.id)!.conversation.at(-1)?.message).toContain("does not exist");
    expect(engine.getState(runner.id).lastError).toContain("does not exist");
  });

  it("uses the injected command builder", async () => {
    const task = planTask("injected builder");
    const runner = makeRunner(null as unknown as string[], { tool: "claude", model: "opus" });
    const seen: any[] = [];
    const engine = makeEngine({
      buildCommand: (tool, ctx) => {
        seen.push({ tool, ctx });
        return { cmd: ["bash", "-c", `bun run "${CLI}" submit-plan "${ctx.taskId}" --json -m "## Plan"`], cwd: ctx.cwd, env: { ...process.env } as Record<string, string> };
      },
    });
    engine.start(runner.id);
    await waitFor(() => getTaskById(task.id)!.status === TaskStatus.WaitingPlanReview, 20_000, "submit");
    expect(seen).toHaveLength(1);
    expect(seen[0].tool).toBe("claude");
    expect(seen[0].ctx.model).toBe("opus");
    expect(seen[0].ctx.cwd).toBe(PROJECT_DIR);
    expect(seen[0].ctx.role).toBe("planner");
    const updated = getTaskById(task.id)!;
    expect(updated.assignedAgent).toBeNull();
    expect(updated.conversation.some((c) => c.authorName.startsWith("claude@"))).toBe(true);
  });
});

describe("revertClaim", () => {
  it("returns null when the task is not in an active status", () => {
    const task = planTask("not active");
    expect(revertClaim(task.id, "nope")).toBeNull();
    expect(getTaskById(task.id)!.conversation).toHaveLength(0);
  });

  it("falls back to the per-status default when history is unusable", () => {
    const task = planTask("no history");
    updateTask(task.id, { status: TaskStatus.Coding, assignedAgent: { name: "x", tool: "x", model: "x" } });
    const reverted = revertClaim(task.id, "crashed")!;
    expect(reverted.status).toBe(TaskStatus.ReadyForCode);
    expect(reverted.assignedAgent).toBeNull();
    expect(reverted.conversation.at(-1)).toMatchObject({ authorName: "system", message: "crashed", messageType: "system" });
  });

  it("returns to the status recorded in history when valid", () => {
    const task = planTask("with history");
    updateTask(task.id, {
      status: TaskStatus.Coding,
      assignedAgent: { name: "x", tool: "x", model: "x" },
      history: [{ pre_status: TaskStatus.ChangesRequested, new_status: TaskStatus.Coding, timestamp: new Date().toISOString() }],
    });
    expect(revertClaim(task.id, "crashed")!.status).toBe(TaskStatus.ChangesRequested);
  });
});

describe("buildCommand", () => {
  const ctx = {
    cwd: "/repo",
    prompt: "PROMPT",
    promptFile: "/tmp/p.md",
    taskId: "t1",
    role: "implementer",
    model: null,
    effort: null,
    permissionMode: "safe" as const,
    extraArgs: null,
  };

  it("builds claude safe/full commands", () => {
    const safe = buildCommand("claude", ctx);
    expect(safe.cmd.slice(0, 5)).toEqual(["claude", "-p", "PROMPT", "--output-format", "json"]);
    expect(safe.cmd).toContain("--permission-mode");
    expect(safe.cmd).toContain("Bash(agentq:*)");
    expect(safe.env?.AGENTQ_TASK_ID).toBe("t1");
    expect(safe.env?.AGENTQ_ROLE).toBe("implementer");
    expect(safe.env?.AGENTQ_PROMPT_FILE).toBe("/tmp/p.md");
    expect(safe.env?.CLAUDECODE).toBeUndefined();
    const full = buildCommand("claude", { ...ctx, permissionMode: "full", model: "sonnet", extraArgs: ["--verbose"] });
    expect(full.cmd).toContain("--dangerously-skip-permissions");
    expect(full.cmd).not.toContain("--permission-mode");
    expect(full.cmd.slice(-3)).toEqual(["--model", "sonnet", "--verbose"]);
  });

  it("builds codex, opencode, gemini and custom commands", () => {
    expect(buildCommand("codex", ctx).cmd).toEqual(["codex", "exec", "--full-auto", "-C", "/repo", "--skip-git-repo-check", "PROMPT"]);
    expect(buildCommand("codex", { ...ctx, permissionMode: "full", model: "o3" }).cmd).toEqual([
      "codex", "exec", "--dangerously-bypass-approvals-and-sandbox", "-C", "/repo", "--skip-git-repo-check", "-m", "o3", "PROMPT",
    ]);
    expect(buildCommand("opencode", { ...ctx, model: "anthropic/claude" }).cmd).toEqual([
      "opencode", "run", "--dir", "/repo", "--format", "json", "--auto", "-m", "anthropic/claude", "PROMPT",
    ]);
    expect(buildCommand("gemini", ctx).cmd).toEqual(["gemini", "-p", "PROMPT", "--yolo"]);
    const custom = buildCommand("custom", { ...ctx, extraArgs: ["bash", "-c", "echo hi"] });
    expect(custom.cmd).toEqual(["bash", "-c", "echo hi", "PROMPT"]);
    expect(custom.env?.AGENTQ_PROMPT).toBe("PROMPT");
    expect(() => buildCommand("custom", ctx)).toThrow();
  });

  it("passes the effort only to tools that support it", () => {
    const claude = buildCommand("claude", { ...ctx, model: "sonnet", effort: "high", extraArgs: ["--verbose"] });
    expect(claude.cmd.slice(-5)).toEqual(["--model", "sonnet", "--effort", "high", "--verbose"]);
    expect(buildCommand("claude", ctx).cmd).not.toContain("--effort");

    expect(buildCommand("codex", { ...ctx, model: "gpt-5.5", effort: "xhigh", extraArgs: ["--json"] }).cmd).toEqual([
      "codex", "exec", "--full-auto", "-C", "/repo", "--skip-git-repo-check",
      "-m", "gpt-5.5", "-c", 'model_reasoning_effort="xhigh"', "--json", "PROMPT",
    ]);
    expect(buildCommand("codex", { ...ctx, effort: "low" }).cmd).toEqual([
      "codex", "exec", "--full-auto", "-C", "/repo", "--skip-git-repo-check", "-c", 'model_reasoning_effort="low"', "PROMPT",
    ]);

    expect(buildCommand("opencode", { ...ctx, model: "opencode/big-pickle", effort: "max" }).cmd).toEqual([
      "opencode", "run", "--dir", "/repo", "--format", "json", "--auto", "-m", "opencode/big-pickle", "--variant", "max", "PROMPT",
    ]);

    // gemini and custom have no effort flag: the value is ignored.
    expect(buildCommand("gemini", { ...ctx, model: "gemini-2.5-pro", effort: "high" }).cmd).toEqual([
      "gemini", "-p", "PROMPT", "--yolo", "-m", "gemini-2.5-pro",
    ]);
    expect(buildCommand("custom", { ...ctx, effort: "high", extraArgs: ["bash", "-c", "echo hi"] }).cmd).toEqual([
      "bash", "-c", "echo hi", "PROMPT",
    ]);
  });

  it("strips YAML frontmatter from skills", () => {
    expect(stripFrontmatter("---\nname: x\n---\n\n# Body\n")).toBe("# Body\n");
    expect(stripFrontmatter("# Body\n")).toBe("# Body\n");
  });
});
