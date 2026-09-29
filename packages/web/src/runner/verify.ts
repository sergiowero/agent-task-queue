/**
 * The built-in verifier: runs the project's commands (and the ones the approved
 * plan ties to each acceptance criterion) in the task's worktree, looks at the
 * diff for weakened tests and risky paths, and reports through the shared
 * workflow. No LLM involved; it runs inside the web server.
 */
import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { hostname } from "os";
import { join } from "path";
import type { NewEvidence, Project, SubmitVerificationInput, Task } from "@agentq/shared";
import {
  DEFAULT_VERIFY_ALLOWLIST,
  analyzeDiff,
  claimNextTask,
  getProjectById,
  getTaskById,
  profileCommands,
  protectedFiles,
  resolveProfile,
  revertClaim,
  setAppState,
  submitVerification,
} from "@agentq/shared";
import { runsDir } from "./commands.js";

const IS_WINDOWS = process.platform === "win32";
const SUMMARY_LINES = 40;

export const VERIFIER_RUNNER_ID = "builtin:verifier";

export interface VerifyCommand {
  command: string;
  /** Criteria this command verifies (empty for regression commands). */
  criterionIds: string[];
  /** project: from the project profile · plan: from the validation plan or a criterion. */
  source: "project" | "plan";
}

/** Every command to run, once each, in order: install, regression, then per-criterion checks. */
export function verificationCommands(task: Task, project: Project | null): VerifyCommand[] {
  const profile = resolveProfile(project?.profile);
  const out = new Map<string, VerifyCommand>();
  const add = (command: string | undefined, source: VerifyCommand["source"], criterionId?: string) => {
    const cmd = command?.trim();
    if (!cmd) return;
    const entry = out.get(cmd) ?? { command: cmd, criterionIds: [], source };
    if (criterionId && !entry.criterionIds.includes(criterionId)) entry.criterionIds.push(criterionId);
    // A command the project itself defines is trusted even if a plan repeats it.
    if (source === "project") entry.source = "project";
    out.set(cmd, entry);
  };

  if (profile.commands.install) add(profile.commands.install, "project");
  const plan = task.approvedPlan?.validation;
  if (plan?.regressionCommands.length) {
    const projectOwn = new Set(profileCommands(profile));
    for (const cmd of plan.regressionCommands) add(cmd, projectOwn.has(cmd.trim()) ? "project" : "plan");
  } else {
    for (const cmd of profileCommands(profile)) if (cmd !== profile.commands.install) add(cmd, "project");
  }
  for (const item of plan?.items ?? []) add(item.command, "plan", item.criterionId);
  for (const c of task.acceptanceCriteria) {
    if (c.verify.command && (c.verify.kind === "command" || c.verify.kind === "test")) add(c.verify.command, "plan", c.id);
  }
  return [...out.values()];
}

/**
 * Commands written by agents run outside any tool sandbox, so they only run when
 * a person approved the plan they come from, or they match the allowlist.
 */
export function isAllowed(cmd: VerifyCommand, task: Task, project: Project | null): boolean {
  if (cmd.source === "project") return true;
  if (task.approvedPlan?.approvedBy === "user") return true;
  const profile = resolveProfile(project?.profile);
  const prefixes = [...DEFAULT_VERIFY_ALLOWLIST, ...profile.verifyAllowlist, ...profileCommands(profile)];
  return prefixes.some((p) => p.trim() && cmd.command.startsWith(p.trim()));
}

export interface ExecResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

/** How long a killed command may keep its output pipes open before we stop waiting for it. */
const KILL_GRACE_MS = 2000;

/**
 * Runs one shell command with CI=1. After `timeoutMs` the whole process tree is
 * killed (its own process group on POSIX, `taskkill /T` on Windows): killing
 * only the shell would leave `a && b` or an npm script running and holding the
 * output pipes, so the verifier would wait for it forever.
 */
export function execCommand(command: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const env = { ...process.env, CI: "1", FORCE_COLOR: "0" };
    const child = IS_WINDOWS
      ? spawn("cmd", ["/d", "/s", "/c", `"${command}"`], { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsVerbatimArguments: true, windowsHide: true })
      : spawn("sh", ["-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    let timedOut = false;
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | null = null;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ exitCode: timedOut ? 124 : code, output: stdout + (stderr ? `\n${stderr}` : ""), timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      // A grandchild that left the group could still hold the pipes: do not wait for it.
      grace = setTimeout(() => finish(124), KILL_GRACE_MS);
    }, timeoutMs);
    child.on("error", (e) => {
      stderr += `${e.message}\n`;
      finish(127);
    });
    child.on("close", (code, signal) => finish(code ?? (signal ? 137 : 1)));
  });
}

/** Kills a command and everything it started. */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (IS_WINDOWS) Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"]);
    // The command leads its own process group (detached), so -pid reaches all of it.
    else process.kill(-pid, "SIGKILL");
  } catch {}
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function summarize(output: string, lines = SUMMARY_LINES): string {
  const clean = output.replace(ANSI, "").split("\n").filter((l) => l.trim() !== "");
  return clean.slice(-lines).join("\n");
}

// ─── Verification run ─────────────────────────────────────────────────

export type VerificationReport = Omit<SubmitVerificationInput, "claimToken" | "agentId" | "author">;

export interface RunVerificationOptions {
  /** Overrides the project's verifyTimeoutSec (tests). */
  timeoutMs?: number;
  exec?: typeof execCommand;
}

export async function runVerification(
  task: Task,
  project: Project | null,
  opts: RunVerificationOptions = {},
): Promise<VerificationReport> {
  const cwd = task.worktreePath;
  if (!cwd || !existsSync(cwd)) {
    return { passed: false, evidence: [], infraError: `The task's worktree ${cwd ?? "(not recorded)"} does not exist.` };
  }
  const profile = resolveProfile(project?.profile);
  const timeoutMs = opts.timeoutMs ?? profile.verifyTimeoutSec * 1000;
  const exec = opts.exec ?? execCommand;
  const round = task.codeRound + 1;
  const logDir = runsDir(task.id);
  mkdirSync(logDir, { recursive: true });

  const evidence: NewEvidence[] = [];
  let passed = true;
  const commands = verificationCommands(task, project);
  for (const [i, cmd] of commands.entries()) {
    const rows = (summary: string, extra: Partial<NewEvidence>): NewEvidence[] =>
      (cmd.criterionIds.length ? cmd.criterionIds : [null]).map((criterionId) => ({
        kind: "command",
        command: cmd.command,
        criterionId,
        summary,
        ...extra,
      }));
    if (!isAllowed(cmd, task, project)) {
      evidence.push(
        ...rows("Skipped: the command comes from the plan, is not in the project's commands or verify allowlist, and no person approved the plan.", {
          skipped: true,
          exitCode: null,
        }),
      );
      continue;
    }
    let result = await exec(cmd.command, cwd, timeoutMs);
    let flaky = false;
    if (result.exitCode !== 0 && !result.timedOut) {
      const retry = await exec(cmd.command, cwd, timeoutMs);
      if (retry.exitCode === 0) flaky = true;
      result = retry.exitCode === 0 ? retry : result;
    }
    const logPath = join(logDir, `verify-R${round}-${i + 1}.log`);
    try {
      writeFileSync(logPath, `$ ${cmd.command}\n${result.output}\n[exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}]\n`);
    } catch {}
    const summary = result.timedOut
      ? `Timed out after ${Math.round(timeoutMs / 1000)} s.\n${summarize(result.output, 10)}`
      : summarize(result.output) || "(no output)";
    evidence.push(...rows(summary, { exitCode: result.exitCode, logPath, flaky }));
    if (result.exitCode !== 0) passed = false;
  }

  const diff = analyzeDiff(cwd, task.mergeBranch);
  // The approved plan's new tests must exist: a criterion whose planned test is missing fails.
  for (const item of task.approvedPlan?.validation?.items ?? []) {
    for (const path of item.newTests ?? []) {
      const file = path.trim().replace(/^\.\//, "");
      if (!file || existsSync(join(cwd, file))) continue;
      evidence.push({ kind: "manual", criterionId: item.criterionId, exitCode: 1, summary: `Planned test ${file} was not added.` });
      passed = false;
    }
  }
  return {
    passed,
    evidence,
    tampering: diff?.tampering ?? [],
    diffStats: diff?.diffStats ?? null,
    touchedProtected: diff ? protectedFiles(diff.changedFiles, profile) : [],
    verifiedSha: diff?.headSha ?? null,
  };
}

// ─── Worker ───────────────────────────────────────────────────────────

export interface VerifyWorkerOptions {
  broadcast?: (event: string, data: unknown) => void;
  intervalMs?: number;
  /** How often the worker says it is alive, also while a long verification runs. */
  heartbeatMs?: number;
  run?: typeof runVerification;
}

/** Claims `verify_requested` tasks one at a time and verifies them. */
export class VerifyWorker {
  private readonly broadcast: (event: string, data: unknown) => void;
  private readonly intervalMs: number;
  private readonly heartbeatMs: number;
  private readonly run: typeof runVerification;
  private timer: Timer | null = null;
  private heartbeat: Timer | null = null;
  private busy = false;
  running = false;
  lastRunAt: string | null = null;
  currentTaskId: string | null = null;

  constructor(opts: VerifyWorkerOptions = {}) {
    this.broadcast = opts.broadcast ?? (() => {});
    this.intervalMs = opts.intervalMs ?? 3000;
    this.heartbeatMs = opts.heartbeatMs ?? 30_000;
    this.run = opts.run ?? runVerification;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // The beat runs on its own timer: a verification can take longer than the
    // 2 minutes after which submit_code and the sweeper count the verifier as gone.
    this.beat();
    this.heartbeat = setInterval(() => this.beat(), this.heartbeatMs);
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  state() {
    return { running: this.running, busy: this.busy, currentTaskId: this.currentTaskId, lastRunAt: this.lastRunAt };
  }

  private beat(): void {
    try {
      setAppState("verifier_heartbeat", new Date().toISOString());
    } catch (e) {
      console.error("[verifier]", e);
    }
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  /** One pass: heartbeat, then verify at most one task. Returns the task verified, if any. */
  async tick(): Promise<string | null> {
    let verified: string | null = null;
    try {
      setAppState("verifier_heartbeat", new Date().toISOString());
      if (this.busy) return null;
      const claimed = claimNextTask({
        roles: ["verify"],
        agent: { toolName: "agentq-verifier", version: "1", model: "none", sessionId: VERIFIER_RUNNER_ID, host: hostname() },
        runnerId: VERIFIER_RUNNER_ID,
      });
      if (!claimed) return null;
      this.busy = true;
      this.currentTaskId = claimed.task.id;
      this.broadcast("task_updated", claimed.task);
      try {
        const project = claimed.task.projectId ? getProjectById(claimed.task.projectId) : null;
        const report = await this.run(claimed.task, project);
        submitVerification(claimed.task.id, { ...report, claimToken: claimed.claimToken, author: "runner:verify" });
        verified = claimed.task.id;
      } catch (e: any) {
        revertClaim(claimed.task.id, `The verifier failed: ${e?.message ?? e}`);
      } finally {
        this.busy = false;
        this.currentTaskId = null;
        this.lastRunAt = new Date().toISOString();
        const task = getTaskById(claimed.task.id);
        if (task) this.broadcast("task_updated", task);
      }
    } catch (e) {
      console.error("[verifier]", e);
    } finally {
      this.schedule(verified ? 0 : this.intervalMs);
    }
    return verified;
  }
}
