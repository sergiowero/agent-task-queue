import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerLaunch } from "@agentq/mcp";
import { RUNNER_MCP_TOOLS, mcpServerLaunch } from "@agentq/mcp";
import type { Runner, RunnerTool } from "@agentq/shared";
import {
  TaskStatus,
  createProject,
  createRunner,
  createTask,
  deleteRunner,
  getDbPath,
  getTaskById,
  getTasks,
  getActivityEvents,
  resetDb,
  revertClaim,
  updateTask,
} from "@agentq/shared";
import { RunnerEngine, type RunnerJob } from "./runner.js";
import type { BuiltCommand, CommandContext } from "./commands.js";
import { CLAUDE_AGENTQ_TOOLS, buildCommand, geminiSettings, opencodeConfigContent } from "./commands.js";
import { buildPrompt, stripFrontmatter } from "./prompt.js";

// The engine claims in-process while the agent's MCP server opens the database
// by path, so this file needs a FILE database. Other test files may already have
// opened the singleton on ":memory:"; resetDb() reopens it on our path.
const DB_PATH = join(tmpdir(), `agentq-runner-test-${randomUUID()}.db`);
const HOME = join(tmpdir(), `agentq-runner-home-${randomUUID()}`);
const PROJECT_DIR = join(tmpdir(), `agentq-runner-project-${randomUUID()}`);
const FAKE_AGENT = resolve(import.meta.dir, "testing/fake-agent.ts");
const BUN = process.execPath;

const previousDbPath = process.env.AGENTQ_DB_PATH;
const previousHome = process.env.AGENTQ_HOME;
process.env.AGENTQ_DB_PATH = DB_PATH;
process.env.AGENTQ_HOME = HOME;
resetDb();

const projectId = randomUUID();
const events: { event: string; data: any }[] = [];
const engines: RunnerEngine[] = [];
const runners: Runner[] = [];

/** argv for a custom runner whose "tool" submits the claimed task through the AgentQ MCP server. */
function agentArgv(tool: string, args: Record<string, unknown>, ...flags: string[]): string[] {
  return [BUN, FAKE_AGENT, tool, JSON.stringify(args), ...flags];
}

/** argv for a custom runner that runs a bun snippet (portable stand-in for a shell). */
function bunEval(code: string): string[] {
  return [BUN, "-e", code];
}

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
  it("claims a task, runs the tool, and the agent submits it through the AgentQ MCP server", async () => {
    const task = planTask("submits a plan");
    const runner = makeRunner(agentArgv("submit_plan", { message: "## Plan", context: "planned via MCP" }));
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
    expect(updated.conversation.some((c) => c.message === "## Plan" && c.messageType === "plan")).toBe(true);
    expect(updated.contexts).toEqual([`Claimed by runner ${runner.name}`, "planned via MCP"]);
    expect(updated.history.map((h) => [h.pre_status, h.new_status])).toEqual([
      [TaskStatus.PlanRequested, TaskStatus.Planning],
      [TaskStatus.Planning, TaskStatus.WaitingPlanReview],
    ]);

    // Log, prompt and MCP config live under AGENTQ_HOME/runs/<taskId>/.
    expect(existsSync(job.logPath)).toBe(true);
    const log = readFileSync(job.logPath, "utf8");
    expect(log).toContain("prompt file:");
    expect(log).toContain("AgentQ MCP server:");
    const promptFile = join(HOME, "runs", task.id, `${job.id}.prompt.md`);
    expect(existsSync(promptFile)).toBe(true);
    const prompt = readFileSync(promptFile, "utf8");
    expect(prompt).toContain(task.id);
    expect(prompt).toContain("Do **NOT** call `claim_task`");
    expect(prompt).toContain("`submit_plan` tool of the `agentq` MCP server");
    expect(prompt).not.toContain("allowed-tools:");

    const mcpConfig = JSON.parse(readFileSync(join(HOME, "runs", task.id, `${job.id}.mcp.json`), "utf8"));
    expect(mcpConfig).toEqual({ mcpServers: { agentq: mcpServerLaunch(DB_PATH) } });

    const kinds = events.filter((e) => e.event === "runner_job").map((e) => e.data.type);
    expect(kinds[0]).toBe("started");
    expect(kinds).toContain("output");
    expect(kinds[kinds.length - 1]).toBe("finished");
    expect(events.some((e) => e.event === "task_updated" && e.data.id === task.id)).toBe(true);
    expect(engine.readLog(engine.getJob(runner.id, job.id)!, 5)).toContain("job succeeded");
  });

  it("reverts the task when the tool exits without submitting", async () => {
    const task = planTask("exits early");
    const runner = makeRunner(bunEval("console.error('boom'); process.exit(3)"));
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
    const runner = makeRunner(bunEval("process.exit(1)"));
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
    const runner = makeRunner(agentArgv("submit_plan", { message: "## Plan" }, "--sleep", "1500"), { concurrency: 1 });
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
    const runner = makeRunner(bunEval("setTimeout(() => {}, 30000)"));
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

  it("times out jobs that exceed the limit, even when a child process holds the output open", async () => {
    const task = planTask("times out");
    // The tool starts a grandchild that inherits its stdout and outlives it.
    const runner = makeRunner(
      bunEval(
        `Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], { stdout: "inherit", stderr: "inherit" }); setTimeout(() => {}, 30000)`,
      ),
    );
    const engine = makeEngine({ jobTimeoutMs: 500, drainMs: 500 });
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
    const runner = makeRunner(bunEval("process.exit(0)"), { projectId: missingProject });
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

  it("the claude command's MCP config reaches the web server's database (injected builder)", async () => {
    const task = planTask("injected builder");
    const runner = makeRunner(null as unknown as string[], { tool: "claude", model: "opus" });
    const seen: { tool: RunnerTool; ctx: CommandContext; built: BuiltCommand }[] = [];
    const engine = makeEngine({
      buildCommand: (tool, ctx) => {
        const built = buildCommand(tool, ctx);
        seen.push({ tool, ctx, built });
        // Stand in for the claude binary, using the MCP config the real command carries.
        const config = built.cmd[built.cmd.indexOf("--mcp-config") + 1];
        return {
          cmd: agentArgv("submit_plan", { taskId: ctx.taskId, message: "## Plan", author: "claude@runner" }, "--config", config),
          cwd: ctx.cwd,
          env: built.env,
        };
      },
    });
    engine.start(runner.id);
    await waitFor(() => getTaskById(task.id)!.status === TaskStatus.WaitingPlanReview, 20_000, "submit");
    expect(seen).toHaveLength(1);
    expect(seen[0].tool).toBe("claude");
    expect(seen[0].ctx.model).toBe("opus");
    expect(seen[0].ctx.cwd).toBe(PROJECT_DIR);
    expect(seen[0].ctx.role).toBe("planner");
    expect(seen[0].ctx.mcp).toEqual(mcpServerLaunch(DB_PATH));
    expect(existsSync(seen[0].ctx.mcpConfigFile)).toBe(true);
    const updated = getTaskById(task.id)!;
    expect(updated.assignedAgent).toBeNull();
    expect(updated.conversation.some((c) => c.authorName.startsWith("claude@"))).toBe(true);
  });

  it("fails the job with a clear message when the tool's MCP setup cannot be prepared", async () => {
    const settings = join(HOME, "broken-gemini-system-settings.json");
    mkdirSync(HOME, { recursive: true });
    writeFileSync(settings, "{ not json");
    const previous = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settings;
    try {
      const task = planTask("gemini without MCP");
      const runner = makeRunner(null as unknown as string[], { tool: "gemini" });
      const engine = makeEngine();
      engine.start(runner.id);
      const job = await waitFor(() => {
        const j = lastJob(engine, runner.id);
        return j && j.status !== "running" ? j : null;
      }, 10_000, "job to finish");
      expect(job.status).toBe("reverted");
      expect(job.pid).toBeNull();
      const message = getTaskById(task.id)!.conversation.at(-1)!.message;
      expect(message).toContain("could not build the gemini command");
      expect(message).toContain("cannot add the AgentQ MCP server");
      expect(engine.getState(runner.id).lastError).toContain(settings);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      else process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = previous;
    }
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
  const mcp: McpServerLaunch = { command: "/bin/bun", args: ["run", "/agentq/packages/mcp/src/index.ts"], env: { AGENTQ_DB_PATH: "/data/agentq.db" } };
  const ctx: CommandContext = {
    cwd: "/repo",
    prompt: "PROMPT",
    promptFile: "/tmp/p.md",
    mcp,
    mcpConfigFile: "/runs/t1/job.mcp.json",
    taskId: "t1",
    role: "implementer",
    model: null,
    effort: null,
    permissionMode: "safe" as const,
    extraArgs: null,
  };
  const CODEX_MCP = [
    "-c", 'mcp_servers.agentq.command="/bin/bun"',
    "-c", 'mcp_servers.agentq.args=["run", "/agentq/packages/mcp/src/index.ts"]',
    "-c", 'mcp_servers.agentq.env={ "AGENTQ_DB_PATH" = "/data/agentq.db" }',
  ];

  it("gives every child the job's MCP config and database", () => {
    for (const tool of ["claude", "codex", "opencode", "custom"] as const) {
      const env = buildCommand(tool, { ...ctx, extraArgs: tool === "custom" ? ["agent"] : null }).env!;
      expect(env.AGENTQ_MCP_CONFIG).toBe("/runs/t1/job.mcp.json");
      expect(env.AGENTQ_DB_PATH).toBe("/data/agentq.db");
      expect(env.AGENTQ_TASK_ID).toBe("t1");
    }
  });

  it("claude: --mcp-config on every run; safe mode allows exactly the runner's AgentQ tools", () => {
    const safe = buildCommand("claude", ctx);
    expect(safe.cmd.slice(0, 7)).toEqual(["claude", "-p", "PROMPT", "--output-format", "json", "--mcp-config", "/runs/t1/job.mcp.json"]);
    expect(safe.cmd).toContain("--permission-mode");
    const allowed = safe.cmd.slice(safe.cmd.indexOf("--allowedTools") + 1);
    expect(CLAUDE_AGENTQ_TOOLS).toEqual(RUNNER_MCP_TOOLS.map((t) => `mcp__agentq__${t}`));
    for (const tool of CLAUDE_AGENTQ_TOOLS) expect(allowed).toContain(tool);
    // Nothing broader than the tools a claimed job needs.
    expect(allowed.filter((t) => t.startsWith("mcp__"))).toEqual(CLAUDE_AGENTQ_TOOLS);
    for (const denied of ["mcp__agentq", "mcp__agentq__claim_task", "mcp__agentq__create_task", "mcp__agentq__archive_task"]) {
      expect(allowed).not.toContain(denied);
    }
    expect(allowed.some((t) => t.startsWith("Bash(agentq"))).toBe(false);
    expect(safe.env?.AGENTQ_TASK_ID).toBe("t1");
    expect(safe.env?.AGENTQ_ROLE).toBe("implementer");
    expect(safe.env?.AGENTQ_PROMPT_FILE).toBe("/tmp/p.md");
    expect(safe.env?.CLAUDECODE).toBeUndefined();

    const full = buildCommand("claude", { ...ctx, permissionMode: "full", model: "sonnet", extraArgs: ["--verbose"] });
    expect(full.cmd).toContain("--dangerously-skip-permissions");
    expect(full.cmd).not.toContain("--permission-mode");
    expect(full.cmd).not.toContain("--allowedTools");
    expect(full.cmd.slice(5, 7)).toEqual(["--mcp-config", "/runs/t1/job.mcp.json"]);
    expect(full.cmd.slice(-3)).toEqual(["--model", "sonnet", "--verbose"]);
  });

  it("codex: the server comes in as -c mcp_servers.agentq.* overrides", () => {
    expect(buildCommand("codex", ctx).cmd).toEqual(["codex", "exec", "--full-auto", "-C", "/repo", "--skip-git-repo-check", ...CODEX_MCP, "PROMPT"]);
    expect(buildCommand("codex", { ...ctx, permissionMode: "full", model: "o3" }).cmd).toEqual([
      "codex", "exec", "--dangerously-bypass-approvals-and-sandbox", "-C", "/repo", "--skip-git-repo-check", ...CODEX_MCP, "-m", "o3", "PROMPT",
    ]);
    // Windows paths survive the TOML quoting.
    const win = buildCommand("codex", { ...ctx, mcp: { ...mcp, command: "C:\\bun\\bun.exe" } }).cmd;
    expect(Bun.TOML.parse(win[win.indexOf("-c") + 1].replace("=", " = "))).toEqual({
      mcp_servers: { agentq: { command: "C:\\bun\\bun.exe" } },
    });
  });

  it("opencode: the server comes in through OPENCODE_CONFIG_CONTENT, keeping existing content", () => {
    const built = buildCommand("opencode", { ...ctx, model: "anthropic/claude" });
    expect(built.cmd).toEqual(["opencode", "run", "--dir", "/repo", "--format", "json", "--auto", "-m", "anthropic/claude", "PROMPT"]);
    expect(JSON.parse(built.env!.OPENCODE_CONFIG_CONTENT)).toEqual({
      mcp: {
        agentq: {
          type: "local",
          command: ["/bin/bun", "run", "/agentq/packages/mcp/src/index.ts"],
          environment: { AGENTQ_DB_PATH: "/data/agentq.db" },
          enabled: true,
        },
      },
    });
    const merged = JSON.parse(opencodeConfigContent(mcp, JSON.stringify({ theme: "x", mcp: { other: { type: "remote" } } })));
    expect(merged.theme).toBe("x");
    expect(Object.keys(merged.mcp).sort()).toEqual(["agentq", "other"]);
    expect(JSON.parse(opencodeConfigContent(mcp, "not json")).mcp.agentq.type).toBe("local");
  });

  it("gemini: a per-job system settings file adds the server and keeps admin settings", () => {
    const dir = join(tmpdir(), `agentq-gemini-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const system = join(dir, "system.json");
    const previous = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    try {
      writeFileSync(system, JSON.stringify({ telemetry: { enabled: false }, mcpServers: { corp: { command: "corp-mcp" } } }));
      process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = system;
      const built = buildCommand("gemini", ctx);
      expect(built.cmd).toEqual(["gemini", "-p", "PROMPT", "--yolo"]);
      expect(built.env!.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toBe("/runs/t1/job.gemini-settings.json");
      expect(built.files).toHaveLength(1);
      expect(built.files![0].path).toBe("/runs/t1/job.gemini-settings.json");
      expect(JSON.parse(built.files![0].content)).toEqual({
        telemetry: { enabled: false },
        mcpServers: { corp: { command: "corp-mcp" }, agentq: mcp },
      });

      // No system settings at all: just the server.
      expect(JSON.parse(geminiSettings(mcp, join(dir, "missing.json")))).toEqual({ mcpServers: { agentq: mcp } });

      writeFileSync(system, "{ // comments are not JSON");
      expect(() => buildCommand("gemini", ctx)).toThrow(/cannot add the AgentQ MCP server/);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      else process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("custom: extraArgs is the argv; the server is documented through $AGENTQ_MCP_CONFIG", () => {
    const custom = buildCommand("custom", { ...ctx, extraArgs: ["bash", "-c", "echo hi"] });
    expect(custom.cmd).toEqual(["bash", "-c", "echo hi", "PROMPT"]);
    expect(custom.env?.AGENTQ_PROMPT).toBe("PROMPT");
    expect(custom.env?.AGENTQ_MCP_CONFIG).toBe("/runs/t1/job.mcp.json");
    expect(() => buildCommand("custom", ctx)).toThrow();
  });

  it("passes the effort only to tools that support it", () => {
    const claude = buildCommand("claude", { ...ctx, model: "sonnet", effort: "high", extraArgs: ["--verbose"] });
    expect(claude.cmd.slice(-5)).toEqual(["--model", "sonnet", "--effort", "high", "--verbose"]);
    expect(buildCommand("claude", ctx).cmd).not.toContain("--effort");

    expect(buildCommand("codex", { ...ctx, model: "gpt-5.5", effort: "xhigh", extraArgs: ["--json"] }).cmd).toEqual([
      "codex", "exec", "--full-auto", "-C", "/repo", "--skip-git-repo-check", ...CODEX_MCP,
      "-m", "gpt-5.5", "-c", 'model_reasoning_effort="xhigh"', "--json", "PROMPT",
    ]);
    expect(buildCommand("codex", { ...ctx, effort: "low" }).cmd).toEqual([
      "codex", "exec", "--full-auto", "-C", "/repo", "--skip-git-repo-check", ...CODEX_MCP, "-c", 'model_reasoning_effort="low"', "PROMPT",
    ]);

    expect(buildCommand("opencode", { ...ctx, model: "opencode/big-pickle", effort: "max" }).cmd).toEqual([
      "opencode", "run", "--dir", "/repo", "--format", "json", "--auto", "-m", "opencode/big-pickle", "--variant", "max", "PROMPT",
    ]);

    // gemini and custom have no effort flag: the value is ignored.
    const previous = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = join(tmpdir(), `agentq-no-gemini-${randomUUID()}.json`);
    try {
      expect(buildCommand("gemini", { ...ctx, model: "gemini-2.5-pro", effort: "high" }).cmd).toEqual([
        "gemini", "-p", "PROMPT", "--yolo", "-m", "gemini-2.5-pro",
      ]);
    } finally {
      if (previous === undefined) delete process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      else process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = previous;
    }
    expect(buildCommand("custom", { ...ctx, effort: "high", extraArgs: ["bash", "-c", "echo hi"] }).cmd).toEqual([
      "bash", "-c", "echo hi", "PROMPT",
    ]);
  });

  it("strips YAML frontmatter from skills", () => {
    expect(stripFrontmatter("---\nname: x\n---\n\n# Body\n")).toBe("# Body\n");
    expect(stripFrontmatter("# Body\n")).toBe("# Body\n");
  });
});

describe("each tool's MCP config starts a working AgentQ server", () => {
  // Rebuilds the launch spec the way each tool reads it, starts the server with
  // it (as that tool would) and reads a task from the runner's database.
  const dir = join(tmpdir(), `agentq-runner-mcp-${randomUUID()}`);
  const mcpConfigFile = join(dir, "job.mcp.json");
  const previousGemini = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = join(dir, "no-system-settings.json");
  });

  afterAll(() => {
    if (previousGemini === undefined) delete process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
    else process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = previousGemini;
    rmSync(dir, { recursive: true, force: true });
  });

  function launchFor(tool: RunnerTool, built: BuiltCommand): McpServerLaunch {
    switch (tool) {
      case "claude":
        return JSON.parse(readFileSync(built.cmd[built.cmd.indexOf("--mcp-config") + 1], "utf8")).mcpServers.agentq;
      case "codex": {
        const lines = built.cmd.filter((_, i) => built.cmd[i - 1] === "-c" && built.cmd[i].startsWith("mcp_servers."));
        const server = (Bun.TOML.parse(lines.map((l) => l.replace("=", " = ")).join("\n")) as any).mcp_servers.agentq;
        return { command: server.command, args: server.args, env: server.env };
      }
      case "opencode": {
        const server = JSON.parse(built.env!.OPENCODE_CONFIG_CONTENT).mcp.agentq;
        return { command: server.command[0], args: server.command.slice(1), env: server.environment };
      }
      case "gemini":
        return JSON.parse(built.files![0].content).mcpServers.agentq;
      case "custom":
        return JSON.parse(readFileSync(built.env!.AGENTQ_MCP_CONFIG, "utf8")).mcpServers.agentq;
    }
  }

  for (const tool of ["claude", "codex", "opencode", "gemini", "custom"] as const) {
    it(tool, async () => {
      const task = planTask(`mcp config for ${tool}`);
      const mcp = mcpServerLaunch(getDbPath());
      writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: { agentq: mcp } }));
      const built = buildCommand(tool, {
        cwd: PROJECT_DIR,
        prompt: "PROMPT",
        promptFile: join(dir, "job.prompt.md"),
        mcp,
        mcpConfigFile,
        taskId: task.id,
        role: "planner",
        model: null,
        effort: null,
        permissionMode: "safe",
        extraArgs: tool === "custom" ? ["agent"] : null,
      });
      const launch = launchFor(tool, built);
      expect(launch).toEqual(mcp);

      const client = new Client({ name: `as-${tool}`, version: "0.0.0" });
      await client.connect(new StdioClientTransport({ ...launch, stderr: "ignore" }));
      try {
        const names = (await client.listTools()).tools.map((t) => t.name);
        for (const name of RUNNER_MCP_TOOLS) expect(names).toContain(name);
        const got = (await client.callTool({ name: "get_task", arguments: { taskId: task.id } })) as any;
        expect(got.structuredContent.task.title).toBe(`mcp config for ${tool}`);
      } finally {
        await client.close();
      }
    });
  }
});

describe("buildPrompt", () => {
  it("names the submit tool and its arguments for every phase", () => {
    const agent = { id: "claude@1|opus", toolName: "claude", version: "1", model: "opus", role: "senior", sessionId: "s", host: null, startedAt: "", lastSeen: "", deletedAt: null } as any;
    const cases: [TaskStatus, string, string[]][] = [
      [TaskStatus.Planning, "submit_plan", ["message"]],
      [TaskStatus.Coding, "submit_code", ["message", "worktree"]],
      [TaskStatus.Reviewing, "submit_review", ["message"]],
      [TaskStatus.Merging, "submit_merge", ["mergeBranch", "commit", "authors", "message"]],
    ];
    for (const [status, tool, args] of cases) {
      const task = { ...planTask(`prompt ${status}`), status };
      const prompt = buildPrompt({ task, project: null, agent, effectiveRole: "senior", phaseSkill: "SKILL" });
      expect(prompt).toContain(`call the \`${tool}\` tool of the \`agentq\` MCP server`);
      expect(prompt).toContain(`"taskId": "${task.id}"`);
      for (const arg of [...args, "context"]) expect(prompt).toContain(`"${arg}":`);
      expect(prompt).toContain("Do **NOT** call `claim_task`");
      expect(prompt).toContain("mcp__agentq__<tool>");
      expect(prompt).not.toMatch(/agentq (claim|submit)/);
    }
  });

  it("inlines phase skills that speak MCP, not a command line", () => {
    for (const phase of ["plan", "code", "review", "merge"] as const) {
      const task = { ...planTask(`skill ${phase}`), status: { plan: TaskStatus.Planning, code: TaskStatus.Coding, review: TaskStatus.Reviewing, merge: TaskStatus.Merging }[phase] };
      const agent = { id: "a", toolName: "claude", model: "m" } as any;
      const prompt = buildPrompt({ task, project: null, agent, effectiveRole: "senior" });
      expect(prompt).toContain(`## Phase skill: agentq-${phase}`);
      expect(prompt).toContain(`submit_${phase}`);
      expect(prompt).not.toContain("skill file not found");
      expect(prompt).not.toMatch(/agentq (claim|submit|list|get|create|projects|archive)\b/);
    }
  });
});
