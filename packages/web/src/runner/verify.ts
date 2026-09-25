/**
 * The built-in verifier: runs the project's commands (and the ones the approved
 * plan ties to each acceptance criterion) in the task's worktree, looks at the
 * diff for weakened tests and risky paths, and reports through the shared
 * workflow. No LLM involved; it runs inside the web server.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { hostname } from "os";
import { join } from "path";
import type { NewEvidence, Project, SubmitVerificationInput, Task } from "@agentq/shared";
import {
  DEFAULT_VERIFY_ALLOWLIST,
  claimNextTask,
  getProjectById,
  getTaskById,
  git,
  matchesAny,
  profileCommands,
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

/** Runs one shell command with CI=1, killing it (and its children on Windows) after `timeoutMs`. */
export async function execCommand(command: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  const argv = IS_WINDOWS ? ["cmd", "/d", "/s", "/c", command] : ["sh", "-c", command];
  const proc = Bun.spawn(argv, {
    cwd,
    env: { ...process.env, CI: "1", FORCE_COLOR: "0" } as Record<string, string>,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (IS_WINDOWS) {
      try {
        Bun.spawnSync(["taskkill", "/pid", String(proc.pid), "/T", "/F"]);
      } catch {}
    }
    try {
      proc.kill("SIGKILL");
    } catch {}
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text().catch(() => ""),
    new Response(proc.stderr as ReadableStream).text().catch(() => ""),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { exitCode: timedOut ? 124 : code, output: stdout + (stderr ? `\n${stderr}` : ""), timedOut };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function summarize(output: string, lines = SUMMARY_LINES): string {
  const clean = output.replace(ANSI, "").split("\n").filter((l) => l.trim() !== "");
  return clean.slice(-lines).join("\n");
}

// ─── Diff analysis ────────────────────────────────────────────────────

const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const SKIP_PATTERNS: [RegExp, string][] = [
  [/\b(it|test|describe)\.(skip|only|todo)\s*\(/, "skipped or focused test"],
  [/\b(xit|xtest|xdescribe|fit|fdescribe)\s*\(/, "skipped or focused test"],
  [/@pytest\.mark\.skip|pytest\.skip\(/, "skipped pytest"],
  [/\bt\.Skip(Now|f)?\(/, "skipped Go test"],
  [/@Disabled\b|@Ignore\b/, "disabled JUnit test"],
];
const COVERAGE_FILE = /(jest|vitest|vite)\.config\.[cm]?[jt]s$|\.nycrc|bunfig\.toml$|\.c8rc|codecov\.ya?ml$|package\.json$/;
const THRESHOLD = /(threshold|lines|branches|functions|statements|coverage)["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i;

export interface DiffAnalysis {
  diffStats: { files: number; insertions: number; deletions: number };
  changedFiles: string[];
  tampering: string[];
  headSha: string | null;
}

/** Diff of HEAD against where it branched off the merge branch; null when git cannot tell. */
export function analyzeDiff(cwd: string, mergeBranch: string): DiffAnalysis | null {
  const headSha = git(cwd, ["rev-parse", "HEAD"]);
  const base =
    git(cwd, ["merge-base", "HEAD", `origin/${mergeBranch}`]) ?? git(cwd, ["merge-base", "HEAD", mergeBranch]);
  if (!base) return headSha ? { diffStats: { files: 0, insertions: 0, deletions: 0 }, changedFiles: [], tampering: [], headSha } : null;

  const numstat = git(cwd, ["diff", "--numstat", base, "HEAD"]) ?? "";
  let insertions = 0;
  let deletions = 0;
  const changedFiles: string[] = [];
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [add, del, ...path] = line.split("\t");
    insertions += Number(add) || 0;
    deletions += Number(del) || 0;
    changedFiles.push(path.join("\t"));
  }

  const tampering: string[] = [];
  const status = git(cwd, ["diff", "--name-status", base, "HEAD"]) ?? "";
  for (const line of status.split("\n").filter(Boolean)) {
    const [kind, path] = line.split("\t");
    if (kind === "D" && TEST_FILE.test(path)) tampering.push(`deleted test file ${path}`);
  }

  const patch = git(cwd, ["diff", "-U0", base, "HEAD"]) ?? "";
  let file = "";
  const removedThresholds = new Map<string, number>();
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }
    if (line.startsWith("--- ")) continue;
    const added = line.startsWith("+");
    const removed = line.startsWith("-");
    if (!added && !removed) continue;
    const text = line.slice(1);
    if (added && TEST_FILE.test(file)) {
      for (const [pattern, label] of SKIP_PATTERNS) {
        if (pattern.test(text)) tampering.push(`${label} added in ${file}: ${text.trim().slice(0, 120)}`);
      }
    }
    if (COVERAGE_FILE.test(file)) {
      const m = text.match(THRESHOLD);
      if (!m) continue;
      const key = `${file}:${m[1].toLowerCase()}`;
      if (removed) removedThresholds.set(key, Number(m[2]));
      else if (removedThresholds.has(key) && Number(m[2]) < removedThresholds.get(key)!) {
        tampering.push(`coverage ${m[1]} lowered from ${removedThresholds.get(key)} to ${m[2]} in ${file}`);
      }
    }
  }
  return { diffStats: { files: changedFiles.length, insertions, deletions }, changedFiles, tampering, headSha };
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
  return {
    passed,
    evidence,
    tampering: diff?.tampering ?? [],
    diffStats: diff?.diffStats ?? null,
    touchedProtected: diff ? diff.changedFiles.filter((f) => matchesAny(f, profile.protectedPaths)) : [],
    verifiedSha: diff?.headSha ?? null,
  };
}

// ─── Worker ───────────────────────────────────────────────────────────

export interface VerifyWorkerOptions {
  broadcast?: (event: string, data: unknown) => void;
  intervalMs?: number;
  run?: typeof runVerification;
}

/** Claims `verify_requested` tasks one at a time and verifies them. */
export class VerifyWorker {
  private readonly broadcast: (event: string, data: unknown) => void;
  private readonly intervalMs: number;
  private readonly run: typeof runVerification;
  private timer: Timer | null = null;
  private busy = false;
  running = false;
  lastRunAt: string | null = null;
  currentTaskId: string | null = null;

  constructor(opts: VerifyWorkerOptions = {}) {
    this.broadcast = opts.broadcast ?? (() => {});
    this.intervalMs = opts.intervalMs ?? 3000;
    this.run = opts.run ?? runVerification;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  state() {
    return { running: this.running, busy: this.busy, currentTaskId: this.currentTaskId, lastRunAt: this.lastRunAt };
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
