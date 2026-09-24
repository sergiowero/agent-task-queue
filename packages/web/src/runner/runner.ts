import { randomUUID } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir, hostname } from "os";
import { join } from "path";
import { claimEnv, mcpServerLaunch, mcpServersConfig } from "@agentq/mcp";
import type { Agent, Runner, RunnerTool, Task } from "@agentq/shared";
import {
  TaskStatus,
  claimNextTask,
  getDbPath,
  getProjectById,
  getRunnerById,
  getRunners,
  getTaskById,
  getTasks,
  isActiveStatus,
  revertClaim,
} from "@agentq/shared";
import type { BuiltCommand, CommandBuilder } from "./commands.js";
import { buildCommand as defaultBuildCommand, runsDir, toolBinary } from "./commands.js";
import { buildPrompt, phaseForStatus, type Phase } from "./prompt.js";

/** reverted: released for a retry · blocked: the task went to needs_human (no retry). */
export type JobStatus = "running" | "succeeded" | "failed" | "reverted" | "blocked";

export interface RunnerJob {
  id: string;
  runnerId: string;
  taskId: string;
  taskTitle: string;
  phase: Phase;
  pid: number | null;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  status: JobStatus;
  logPath: string;
  /** Last lines of combined stdout/stderr (capped). */
  tail: string[];
}

export interface RunnerLiveState {
  id: string;
  running: boolean;
  activeJobs: number;
  lastError: string | null;
  lastJob: Omit<RunnerJob, "tail"> | null;
  jobCount: number;
}

export interface RunnerEngineOptions {
  buildCommand?: CommandBuilder;
  broadcast?: (event: string, data: unknown) => void;
  /** Kill a job that runs longer than this. Defaults to AGENTQ_JOB_TIMEOUT_MIN (60). */
  jobTimeoutMs?: number;
  /** Grace period between SIGTERM and SIGKILL. */
  killGraceMs?: number;
  /**
   * How long to keep reading output after the tool exited. A grandchild that
   * outlives the tool can hold the pipes open; the job must still finish.
   */
  drainMs?: number;
  /** Max lines kept in memory per job. */
  tailLines?: number;
  /** Job history kept per runner. */
  historyLimit?: number;
  /**
   * Base cooldown before a task whose job was reverted may be claimed again by
   * this engine (doubles per consecutive revert, capped at 30 min). Prevents a
   * crashing tool from being relaunched in a tight loop.
   */
  revertBackoffMs?: number;
}

interface ActiveJob {
  job: RunnerJob;
  proc: ReturnType<typeof Bun.spawn>;
  activeStatus: TaskStatus;
  /** The claim this job holds; the task is still ours while it carries this token. */
  claimToken: string;
  agentTool: string;
  runnerName: string;
  killReason: string | null;
  readers: ReadableStreamDefaultReader<Uint8Array>[];
  timeout: Timer | null;
  killTimer: Timer | null;
  exited: Promise<void>;
}

interface RunnerRuntime {
  id: string;
  running: boolean;
  timer: Timer | null;
  ticking: boolean;
  active: Map<string, ActiveJob>;
  jobs: RunnerJob[];
  lastError: string | null;
  version: string;
}

const OUTPUT_FLUSH_MS = 100;
const IS_WINDOWS = process.platform === "win32";
const MAX_BACKOFF_MS = 30 * 60_000;

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function publicJob(job: RunnerJob): Omit<RunnerJob, "tail"> {
  const { tail: _tail, ...rest } = job;
  return rest;
}

export class RunnerEngine {
  private readonly build: CommandBuilder;
  private readonly broadcast: (event: string, data: unknown) => void;
  private readonly jobTimeoutMs: number;
  private readonly killGraceMs: number;
  private readonly drainMs: number;
  private readonly tailLines: number;
  private readonly historyLimit: number;
  private readonly revertBackoffMs: number;
  private readonly runtimes = new Map<string, RunnerRuntime>();
  private readonly versions = new Map<string, string>();
  /** taskId → consecutive reverts and the time the task may be claimed again. */
  private readonly cooldowns = new Map<string, { count: number; until: number }>();

  constructor(opts: RunnerEngineOptions = {}) {
    this.build = opts.buildCommand ?? defaultBuildCommand;
    this.broadcast = opts.broadcast ?? (() => {});
    const envMin = Number(process.env.AGENTQ_JOB_TIMEOUT_MIN ?? "60");
    this.jobTimeoutMs =
      opts.jobTimeoutMs ?? (Number.isFinite(envMin) && envMin > 0 ? envMin : 60) * 60_000;
    this.killGraceMs = opts.killGraceMs ?? 10_000;
    this.drainMs = opts.drainMs ?? 2000;
    this.tailLines = opts.tailLines ?? 200;
    this.historyLimit = opts.historyLimit ?? 50;
    this.revertBackoffMs = opts.revertBackoffMs ?? 30_000;
  }

  /** Tasks with a recent revert: consecutive count and when they become claimable again. */
  getCooldowns(): { taskId: string; count: number; until: string }[] {
    this.pruneCooldowns();
    return [...this.cooldowns.entries()].map(([taskId, c]) => ({
      taskId,
      count: c.count,
      until: new Date(c.until).toISOString(),
    }));
  }

  /** Forget reverts that expired long ago (the consecutive count survives a normal expiry). */
  private pruneCooldowns(): void {
    const now = Date.now();
    for (const [taskId, c] of this.cooldowns) {
      if (c.until + MAX_BACKOFF_MS <= now) this.cooldowns.delete(taskId);
    }
  }

  private activeCooldownIds(): string[] {
    this.pruneCooldowns();
    const now = Date.now();
    return [...this.cooldowns.entries()].filter(([, c]) => c.until > now).map(([id]) => id);
  }

  private noteRevert(taskId: string): void {
    const prev = this.cooldowns.get(taskId);
    const count = (prev?.count ?? 0) + 1;
    const wait = Math.min(this.revertBackoffMs * 2 ** (count - 1), MAX_BACKOFF_MS);
    this.cooldowns.set(taskId, { count, until: Date.now() + wait });
  }

  // ─── Public API ────────────────────────────────────────────────────

  isRunning(runnerId: string): boolean {
    return this.runtimes.get(runnerId)?.running ?? false;
  }

  getState(runnerId: string): RunnerLiveState {
    const rt = this.runtimes.get(runnerId);
    const last = rt?.jobs[rt.jobs.length - 1] ?? null;
    return {
      id: runnerId,
      running: rt?.running ?? false,
      activeJobs: rt?.active.size ?? 0,
      lastError: rt?.lastError ?? null,
      lastJob: last ? publicJob(last) : null,
      jobCount: rt?.jobs.length ?? 0,
    };
  }

  getJobs(runnerId: string): Omit<RunnerJob, "tail">[] {
    const rt = this.runtimes.get(runnerId);
    return rt ? [...rt.jobs].reverse().map(publicJob) : [];
  }

  getJob(runnerId: string, jobId: string): RunnerJob | null {
    return this.runtimes.get(runnerId)?.jobs.find((j) => j.id === jobId) ?? null;
  }

  /** Last `lines` lines of the job log (file first, in-memory tail as fallback). */
  readLog(job: RunnerJob, lines: number): string {
    let text: string | null = null;
    try {
      if (existsSync(job.logPath)) text = readFileSync(job.logPath, "utf8");
    } catch {}
    const all = text !== null ? text.split("\n") : job.tail;
    if (all.length && all[all.length - 1] === "") all.pop();
    return all.slice(-lines).join("\n") + (all.length ? "\n" : "");
  }

  start(runnerId: string): RunnerLiveState {
    const runner = getRunnerById(runnerId);
    if (!runner) throw new Error("runner not found");
    const rt = this.runtime(runnerId);
    if (rt.running) return this.getState(runnerId);
    rt.running = true;
    rt.lastError = null;
    void this.resolveVersion(runner.tool).then((v) => {
      rt.version = v;
    });
    this.emitRunner(runnerId);
    this.schedule(rt, 0);
    return this.getState(runnerId);
  }

  async stop(runnerId: string, reason = "Runner stopped"): Promise<RunnerLiveState> {
    const rt = this.runtimes.get(runnerId);
    if (!rt) return this.getState(runnerId);
    rt.running = false;
    if (rt.timer) {
      clearTimeout(rt.timer);
      rt.timer = null;
    }
    const exits: Promise<void>[] = [];
    for (const active of rt.active.values()) {
      this.kill(active, reason);
      exits.push(active.exited);
    }
    await Promise.all(exits);
    this.emitRunner(runnerId);
    return this.getState(runnerId);
  }

  /** Called on server boot: starts every runner persisted as enabled. */
  startEnabledRunners(): void {
    for (const runner of getRunners()) {
      if (!runner.enabled) continue;
      try {
        this.start(runner.id);
      } catch (e: any) {
        console.error(`[runner] failed to start ${runner.name}: ${e?.message ?? e}`);
      }
    }
  }

  /** Stops every runner and waits for their children to exit (SIGTERM, then SIGKILL). */
  async shutdown(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((id) => this.stop(id, "Server shutting down")));
  }

  // ─── Loop ──────────────────────────────────────────────────────────

  private runtime(runnerId: string): RunnerRuntime {
    let rt = this.runtimes.get(runnerId);
    if (!rt) {
      rt = {
        id: runnerId,
        running: false,
        timer: null,
        ticking: false,
        active: new Map(),
        jobs: [],
        lastError: null,
        version: "unknown",
      };
      this.runtimes.set(runnerId, rt);
    }
    return rt;
  }

  private schedule(rt: RunnerRuntime, delayMs: number): void {
    if (!rt.running) return;
    if (rt.timer) clearTimeout(rt.timer);
    rt.timer = setTimeout(() => {
      rt.timer = null;
      void this.tick(rt);
    }, delayMs);
  }

  private async tick(rt: RunnerRuntime): Promise<void> {
    if (!rt.running || rt.ticking) return;
    rt.ticking = true;
    const runner = getRunnerById(rt.id);
    if (!runner) {
      // Deleted underneath us: stop quietly.
      rt.ticking = false;
      await this.stop(rt.id, "Runner deleted");
      return;
    }
    try {
      const errorBefore = rt.lastError;
      while (rt.running && rt.active.size < runner.concurrency) {
        const claimed = this.claim(runner, rt);
        if (!claimed) break;
        await this.launch(runner, rt, claimed.task, claimed.effectiveRole, claimed.agent, claimed.claimToken);
      }
      // A clean tick clears a stale error, but not one raised during this tick.
      if (rt.lastError && rt.lastError === errorBefore) {
        rt.lastError = null;
        this.emitRunner(rt.id);
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (rt.lastError !== msg) {
        rt.lastError = msg;
        console.error(`[runner] ${runner.name}: ${msg}`);
        this.emitRunner(rt.id);
      }
    } finally {
      rt.ticking = false;
      this.schedule(rt, Math.max(1, runner.pollIntervalSec) * 1000);
    }
  }

  private claim(runner: Runner, rt: RunnerRuntime) {
    return claimNextTask({
      excludeTaskIds: this.activeCooldownIds(),
      role: runner.role,
      agent: {
        toolName: runner.tool,
        version: rt.version,
        model: runner.model ?? "default",
        sessionId: randomUUID(),
        host: hostname(),
      },
      projectId: runner.projectId ?? undefined,
      context: `Claimed by runner ${runner.name}`,
      runnerId: runner.id,
    });
  }

  /**
   * Called on server boot, before runners start: tasks a runner held when the
   * server went down have no process any more, so they go back to the queue.
   */
  recoverOrphans(): string[] {
    const live = new Set(
      [...this.runtimes.values()].flatMap((rt) => [...rt.active.values()].map((a) => a.job.taskId)),
    );
    const recovered: string[] = [];
    for (const task of getTasks(undefined, { includeArchived: true })) {
      if (!isActiveStatus(task.status) || !task.assignedAgent?.runnerId || live.has(task.id)) continue;
      const reverted = revertClaim(task.id, "The server restarted while a runner job held this task; it went back to the queue.");
      if (reverted) {
        recovered.push(task.id);
        this.broadcast("task_updated", reverted);
      }
    }
    return recovered;
  }

  /**
   * A person took the task away (unblock, cancel, resolve): kill the job still
   * working on it. Its late submits are refused because the claim is gone.
   */
  abandonTask(taskId: string, reason: string): boolean {
    let found = false;
    for (const rt of this.runtimes.values()) {
      for (const active of rt.active.values()) {
        if (active.job.taskId !== taskId) continue;
        found = true;
        this.kill(active, reason);
      }
    }
    return found;
  }

  private async launch(
    runner: Runner,
    rt: RunnerRuntime,
    task: Task,
    effectiveRole: string,
    agent: Agent,
    claimToken: string,
  ): Promise<void> {
    this.broadcast("task_updated", task);
    const jobId = randomUUID();
    const dir = runsDir(task.id);
    const logPath = join(dir, `${jobId}.log`);
    const promptFile = join(dir, `${jobId}.prompt.md`);
    const mcpConfigFile = join(dir, `${jobId}.mcp.json`);
    const phase = phaseForStatus(task.status) ?? "code";

    const job: RunnerJob = {
      id: jobId,
      runnerId: runner.id,
      taskId: task.id,
      taskTitle: task.title,
      phase,
      pid: null,
      startedAt: new Date().toISOString(),
      status: "running",
      logPath,
      tail: [],
    };
    this.pushJob(rt, job);

    const project = task.projectId ? getProjectById(task.projectId) : null;
    const cwd = project ? expandHome(project.workingDirectory) : null;
    if (!cwd || !existsSync(cwd)) {
      const reason = `Runner ${runner.name}: project working directory ${cwd ?? "(none)"} does not exist; task released.`;
      this.finishWithoutSpawn(rt, job, reason, task.id);
      return;
    }

    let built: BuiltCommand;
    try {
      mkdirSync(dir, { recursive: true });
      const prompt = buildPrompt({ task, project, agent, effectiveRole, claimToken });
      writeFileSync(promptFile, prompt);
      // Every job gets the AgentQ MCP server, bound to this server's database and
      // holding the job's claim (so the agent's submits carry the claim token).
      const mcp = mcpServerLaunch(getDbPath(), undefined, claimEnv(task.id, claimToken, agent.id));
      writeFileSync(mcpConfigFile, JSON.stringify(mcpServersConfig(mcp), null, 2));
      built = this.build(runner.tool, {
        cwd,
        prompt,
        promptFile,
        mcp,
        mcpConfigFile,
        taskId: task.id,
        role: effectiveRole,
        model: runner.model,
        effort: runner.effort,
        permissionMode: runner.permissionMode,
        extraArgs: runner.extraArgs,
      });
      for (const file of built.files ?? []) writeFileSync(file.path, file.content);
    } catch (e: any) {
      const reason = `Runner ${runner.name}: could not build the ${runner.tool} command: ${e?.message ?? e}`;
      this.finishWithoutSpawn(rt, job, reason, task.id);
      return;
    }

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      appendFileSync(
        logPath,
        `[agentq] ${job.startedAt} ${runner.name} → ${built.cmd[0]} (task ${task.id}, phase ${phase})\n` +
          `[agentq] AgentQ MCP server: ${mcpConfigFile}\n`,
      );
      proc = Bun.spawn(built.cmd, {
        cwd: built.cwd,
        env: built.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (e: any) {
      const reason = `Runner ${runner.name}: failed to spawn ${built.cmd[0]}: ${e?.message ?? e}`;
      this.finishWithoutSpawn(rt, job, reason, task.id);
      return;
    }

    job.pid = proc.pid;
    const active: ActiveJob = {
      job,
      proc,
      activeStatus: task.status,
      claimToken,
      agentTool: runner.tool,
      runnerName: runner.name,
      killReason: null,
      readers: [],
      timeout: null,
      killTimer: null,
      exited: Promise.resolve(),
    };
    rt.active.set(jobId, active);
    this.emitJob("started", job);
    this.emitRunner(rt.id);

    active.timeout = setTimeout(() => {
      this.kill(active, `timed out after ${Math.round(this.jobTimeoutMs / 60_000)} min`);
    }, this.jobTimeoutMs);

    const pump = Promise.all([
      this.pump(proc.stdout as ReadableStream<Uint8Array>, active),
      this.pump(proc.stderr as ReadableStream<Uint8Array>, active),
    ]);

    active.exited = (async () => {
      const code = await proc.exited;
      const drained = await Promise.race([
        pump.then(() => true),
        Bun.sleep(this.drainMs).then(() => false),
      ]);
      if (!drained) {
        for (const reader of active.readers) reader.cancel().catch(() => {});
      }
      this.onExit(rt, active, code);
    })();
  }

  private finishWithoutSpawn(rt: RunnerRuntime, job: RunnerJob, reason: string, taskId: string): void {
    this.appendOutput(job, `[agentq] ${reason}\n`);
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.exitCode = null;
    rt.lastError = reason;
    const reverted = revertClaim(taskId, reason);
    if (reverted) {
      job.status = reverted.status === TaskStatus.NeedsHuman ? "blocked" : "reverted";
      if (job.status === "reverted") this.noteRevert(taskId);
      this.broadcast("task_updated", reverted);
    }
    this.emitJob("finished", job);
    this.emitRunner(rt.id);
  }

  private async pump(stream: ReadableStream<Uint8Array> | null | undefined, active: ActiveJob) {
    if (!stream) return;
    const { job } = active;
    const reader = stream.getReader();
    active.readers.push(reader);
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.appendOutput(job, decoder.decode(value, { stream: true }));
      }
      const rest = decoder.decode();
      if (rest) this.appendOutput(job, rest);
    } catch {}
  }

  private pendingOutput = new Map<string, { job: RunnerJob; chunks: string[]; timer: Timer | null }>();

  private appendOutput(job: RunnerJob, text: string): void {
    if (!text) return;
    try {
      appendFileSync(job.logPath, text);
    } catch {}
    // Maintain the in-memory tail (the last element may be a partial line).
    const parts = text.split("\n");
    if (job.tail.length === 0) job.tail.push("");
    job.tail[job.tail.length - 1] += parts[0];
    for (let i = 1; i < parts.length; i++) job.tail.push(parts[i]);
    if (job.tail.length > this.tailLines + 1) job.tail.splice(0, job.tail.length - (this.tailLines + 1));

    let pending = this.pendingOutput.get(job.id);
    if (!pending) {
      pending = { job, chunks: [], timer: null };
      this.pendingOutput.set(job.id, pending);
    }
    pending.chunks.push(text);
    if (!pending.timer) {
      pending.timer = setTimeout(() => this.flushOutput(job.id), OUTPUT_FLUSH_MS);
    }
  }

  private flushOutput(jobId: string): void {
    const pending = this.pendingOutput.get(jobId);
    if (!pending) return;
    this.pendingOutput.delete(jobId);
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.chunks.length === 0) return;
    this.broadcast("runner_job", {
      type: "output",
      runnerId: pending.job.runnerId,
      jobId: pending.job.id,
      taskId: pending.job.taskId,
      chunk: pending.chunks.join(""),
    });
  }

  private kill(active: ActiveJob, reason: string): void {
    if (active.killReason) return;
    active.killReason = reason;
    if (IS_WINDOWS) {
      // No SIGTERM on Windows, and ending only the tool would leave its children
      // (a shell's commands, the tool's MCP servers) running: end the whole tree.
      this.appendOutput(active.job, `\n[agentq] ${reason}; ending the process tree\n`);
      killProcessTree(active.proc);
      return;
    }
    this.appendOutput(active.job, `\n[agentq] ${reason}; sending SIGTERM\n`);
    try {
      active.proc.kill("SIGTERM");
    } catch {}
    active.killTimer = setTimeout(() => {
      try {
        active.proc.kill("SIGKILL");
      } catch {}
    }, this.killGraceMs);
  }

  private onExit(rt: RunnerRuntime, active: ActiveJob, code: number | null): void {
    const { job } = active;
    if (active.timeout) clearTimeout(active.timeout);
    if (active.killTimer) clearTimeout(active.killTimer);
    rt.active.delete(job.id);
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    this.flushOutput(job.id);

    const task = getTaskById(job.taskId);
    const stillOurs =
      !!task && task.status === active.activeStatus && task.claimToken === active.claimToken;

    if (stillOurs) {
      const last30 = job.tail.filter((l, i, arr) => !(i === arr.length - 1 && l === "")).slice(-30);
      const why = active.killReason
        ? `Runner ${active.runnerName}: ${active.agentTool} was killed (${active.killReason}) before submitting.`
        : `Runner ${active.runnerName}: ${active.agentTool} exited with code ${code} without submitting.`;
      const reason = `${why} Last output:\n\`\`\`\n${last30.join("\n")}\n\`\`\``;
      const reverted = revertClaim(job.taskId, reason);
      job.status = reverted?.status === TaskStatus.NeedsHuman ? "blocked" : "reverted";
      if (job.status === "reverted") this.noteRevert(job.taskId);
      if (reverted) this.broadcast("task_updated", reverted);
    } else if (task?.status === TaskStatus.NeedsHuman && task.history.at(-1)?.pre_status === active.activeStatus) {
      // The agent reported a blocker: a person must answer, no retry.
      job.status = "blocked";
      this.cooldowns.delete(job.taskId);
      this.broadcast("task_updated", task);
    } else {
      job.status = code === 0 && !active.killReason ? "succeeded" : "failed";
      if (job.status === "succeeded") this.cooldowns.delete(job.taskId);
      if (task) this.broadcast("task_updated", task);
    }
    this.appendOutput(job, `[agentq] exit code ${code} → job ${job.status}\n`);
    this.flushOutput(job.id);
    this.emitJob("finished", job);
    this.emitRunner(rt.id);
    // A slot freed up: look for more work right away.
    if (rt.running) this.schedule(rt, 0);
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private pushJob(rt: RunnerRuntime, job: RunnerJob): void {
    rt.jobs.push(job);
    while (rt.jobs.length > this.historyLimit) {
      const idx = rt.jobs.findIndex((j) => j.status !== "running");
      if (idx === -1) break;
      rt.jobs.splice(idx, 1);
    }
  }

  private emitJob(type: "started" | "finished", job: RunnerJob): void {
    this.broadcast("runner_job", { type, runnerId: job.runnerId, jobId: job.id, job: publicJob(job) });
  }

  private emitRunner(runnerId: string): void {
    this.broadcast("runner_updated", this.getState(runnerId));
  }

  private async resolveVersion(tool: RunnerTool): Promise<string> {
    const cached = this.versions.get(tool);
    if (cached) return cached;
    const version = await detectToolVersion(tool);
    this.versions.set(tool, version ?? "unknown");
    return version ?? "unknown";
  }
}

/** Windows: `taskkill /T /F` on the tree, then a plain kill in case taskkill failed. */
function killProcessTree(proc: ReturnType<typeof Bun.spawn>): void {
  void (async () => {
    try {
      const taskkill = Bun.spawn(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      await taskkill.exited;
    } catch {}
    try {
      proc.kill("SIGKILL");
    } catch {}
  })();
}

/** `<tool> --version` trimmed to its first line, or null when not installed / it fails. */
export async function detectToolVersion(tool: RunnerTool): Promise<string | null> {
  const bin = toolBinary(tool);
  if (!bin || !Bun.which(bin)) return null;
  try {
    const proc = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
    }, 15_000);
    const out = await new Response(proc.stdout as ReadableStream).text();
    await proc.exited;
    clearTimeout(timer);
    const line = out.trim().split("\n")[0]?.trim();
    return line || "unknown";
  } catch {
    return null;
  }
}

export interface ToolInfo {
  tool: RunnerTool;
  installed: boolean;
  version: string | null;
}

export async function listTools(): Promise<ToolInfo[]> {
  const tools: RunnerTool[] = ["claude", "codex", "opencode", "gemini", "custom"];
  return Promise.all(
    tools.map(async (tool) => {
      const bin = toolBinary(tool);
      if (!bin) return { tool, installed: true, version: null };
      const installed = !!Bun.which(bin);
      return { tool, installed, version: installed ? await detectToolVersion(tool) : null };
    }),
  );
}

let engine: RunnerEngine | null = null;

/** Process-wide engine. The first call may pass options (the server wires `broadcast`). */
export function getRunnerEngine(opts?: RunnerEngineOptions): RunnerEngine {
  if (!engine) engine = new RunnerEngine(opts);
  return engine;
}
