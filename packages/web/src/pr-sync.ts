/**
 * Keeps tasks in `pr_open` in step with GitHub through the `gh` CLI: a merged
 * PR completes the task (and archives it when the project asks), a closed one
 * goes to a person, and under L3 a green, low-risk PR can merge itself.
 */
import type { PullRequest, Task } from "@agentq/shared";
import {
  TaskStatus,
  addActivity,
  archiveIfAuto,
  completeFromPullRequest,
  getProjectById,
  getTaskById,
  getTasks,
  policyFor,
  pullRequestClosed,
  recordPullRequest,
} from "@agentq/shared";

export interface GhResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `gh` with these arguments; async, so a slow GitHub never blocks the web server. */
export type GhRunner = (args: string[], cwd: string) => Promise<GhResult>;

/** Milliseconds one `gh` call may run before it is killed (AGENTQ_PR_SYNC_TIMEOUT_SEC, default 30 s). */
export function ghTimeoutMs(): number {
  const sec = Number(process.env.AGENTQ_PR_SYNC_TIMEOUT_SEC ?? "30");
  return (Number.isFinite(sec) && sec > 0 ? sec : 30) * 1000;
}

/**
 * A GhRunner that spawns `command ...args` without waiting on it synchronously
 * and kills it after `timeoutMs` (exit code 124, like timeout(1)). A killed
 * process whose children still hold its output does not hold the sync either.
 */
export function ghRunner(command: string[] = ["gh"], timeoutMs = ghTimeoutMs()): GhRunner {
  return async (args, cwd) => {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([...command, ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    } catch (e) {
      return { exitCode: 127, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
    }
    const done = Promise.all([
      new Response(proc.stdout as ReadableStream).text().catch(() => ""),
      new Response(proc.stderr as ReadableStream).text().catch(() => ""),
      proc.exited,
    ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }));
    let timer: Timer | undefined;
    const timeout = new Promise<GhResult>((resolve) => {
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        resolve({ exitCode: 124, stdout: "", stderr: `${command[0]} timed out after ${timeoutMs / 1000}s` });
      }, timeoutMs);
    });
    try {
      return await Promise.race([done, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** `gh` with the timeout from the environment (read on every call). */
export const defaultGh: GhRunner = (args, cwd) => ghRunner()(args, cwd);

export interface SyncResult {
  checked: string[];
  merged: string[];
  closed: string[];
  autoMerged: string[];
  errors: { taskId: string; error: string }[];
}

const FIELDS = "state,mergedAt,mergedBy,url,number,reviews,statusCheckRollup,headRefName";

type Check = { conclusion?: string | null; state?: string | null; status?: string | null };

function checksOf(rollup: Check[] | undefined): PullRequest["checks"] {
  if (!rollup?.length) return null;
  const outcome = (c: Check) => (c.conclusion || c.state || "").toUpperCase();
  if (rollup.some((c) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(outcome(c)))) return "failure";
  if (rollup.every((c) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(outcome(c)))) return "success";
  return "pending";
}

/** How `gh pr view` finds the task's PR: its URL, its number, or its head branch. */
export function prRef(task: Task): string {
  const pr = task.pullRequest;
  return pr?.url ?? (pr?.number ? String(pr.number) : null) ?? pr?.branch ?? task.realBranch ?? task.recommendedBranch;
}

/** A review as `gh pr view --json reviews` returns it. */
export interface GhReview {
  state?: string | null;
  author?: { login?: string | null } | null;
  body?: string | null;
  submittedAt?: string | null;
}

/** Review states that decide something; a comment-only review leaves a change request standing, as on GitHub. */
const DECIDING = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

/** Each reviewer's latest deciding review (approved, changes requested or dismissed), by login. */
export function latestReviews(reviews: GhReview[] | null | undefined): Map<string, GhReview & { state: string }> {
  const latest = new Map<string, GhReview & { state: string }>();
  const ordered = [...(reviews ?? [])].sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  for (const review of ordered) {
    const login = review.author?.login;
    const state = String(review.state ?? "").toUpperCase();
    if (login && DECIDING.has(state)) latest.set(login, { ...review, state });
  }
  return latest;
}

export function parsePullRequest(json: any, previous: PullRequest | null, now: string): PullRequest {
  const state = String(json.state ?? "").toUpperCase();
  const reviews: GhReview[] = Array.isArray(json.reviews) ? json.reviews : [];
  const reviewers = [...latestReviews(reviews)].filter(([, r]) => r.state === "CHANGES_REQUESTED").map(([login]) => login);
  const everRequested = reviews
    .filter((r) => String(r.state ?? "").toUpperCase() === "CHANGES_REQUESTED")
    .map((r) => r.author?.login)
    .filter((login): login is string => !!login);
  return {
    url: json.url ?? previous?.url ?? null,
    number: json.number ?? previous?.number ?? null,
    state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open",
    branch: json.headRefName ?? previous?.branch ?? null,
    mergedAt: json.mergedAt ?? null,
    mergedBy: json.mergedBy?.login ?? null,
    changesRequestedBy: reviewers,
    changesEverRequestedBy: [
      ...new Set([...(previous?.changesEverRequestedBy ?? previous?.changesRequestedBy ?? []), ...everRequested, ...reviewers]),
    ],
    checks: checksOf(json.statusCheckRollup),
    checkedAt: now,
  };
}

/** Whether the task is still in pr_open: a person may move it while `gh` runs. */
function stillOpen(taskId: string): boolean {
  return getTaskById(taskId)?.status === TaskStatus.PrOpen;
}

/** One pass over every task in pr_open, one `gh` call at a time. */
export async function syncPullRequests(opts: { gh?: GhRunner; now?: Date } = {}): Promise<SyncResult> {
  const gh = opts.gh ?? defaultGh;
  const now = (opts.now ?? new Date()).toISOString();
  const result: SyncResult = { checked: [], merged: [], closed: [], autoMerged: [], errors: [] };

  for (const task of getTasks(undefined, { includeArchived: false }).filter((t) => t.status === TaskStatus.PrOpen)) {
    const project = task.projectId ? getProjectById(task.projectId) : null;
    if (!project) continue;
    const ref = prRef(task);
    const view = await gh(["pr", "view", ref, "--json", FIELDS], project.workingDirectory);
    if (!stillOpen(task.id)) continue;
    if (view.exitCode !== 0) {
      result.errors.push({ taskId: task.id, error: (view.stderr || view.stdout).trim().split("\n")[0] || `gh exited ${view.exitCode}` });
      continue;
    }
    let pr: PullRequest;
    try {
      pr = parsePullRequest(JSON.parse(view.stdout), task.pullRequest, now);
    } catch (e: any) {
      result.errors.push({ taskId: task.id, error: `unreadable gh output: ${e?.message ?? e}` });
      continue;
    }
    result.checked.push(task.id);

    if (pr.state === "merged") {
      completeFromPullRequest(task.id, pr);
      result.merged.push(task.id);
      archiveIfAuto(task.id, { pullRequests: pr.url ? [pr.url] : [] });
      continue;
    }
    if (pr.state === "closed") {
      pullRequestClosed(task.id, pr);
      result.closed.push(task.id);
      continue;
    }
    recordPullRequest(task.id, pr);

    // L3: a green, low-risk PR whose reviewers' latest reviews ask no changes merges itself.
    const policy = policyFor(task);
    if (
      policy.level === 3 &&
      policy.autoMerge &&
      task.risk === "low" &&
      pr.checks === "success" &&
      pr.changesRequestedBy.length === 0
    ) {
      const merge = await gh(["pr", "merge", ref, "--squash"], project.workingDirectory);
      if (merge.exitCode === 0) {
        addActivity(task.id, "pr_auto_merged", "system", pr.url ?? ref);
        if (stillOpen(task.id)) {
          completeFromPullRequest(task.id, { ...pr, state: "merged", mergedAt: now, mergedBy: "agentq-auto-merge" });
          result.autoMerged.push(task.id);
          archiveIfAuto(task.id, { pullRequests: pr.url ? [pr.url] : [] });
        }
      } else {
        result.errors.push({ taskId: task.id, error: `auto-merge failed: ${(merge.stderr || merge.stdout).trim().split("\n")[0]}` });
      }
    }
  }
  return result;
}

/** Periodic sync, started by the web server when `gh` is installed. */
export class PrSync {
  private timer: Timer | null = null;
  private running: Promise<SyncResult> | null = null;
  lastRunAt: string | null = null;
  lastErrors: SyncResult["errors"] = [];
  readonly available: boolean;

  constructor(
    private readonly broadcast: (event: string, data: unknown) => void = () => {},
    private readonly intervalMs = Math.max(30, Number(process.env.AGENTQ_PR_SYNC_SEC ?? "180") || 180) * 1000,
    private readonly gh: GhRunner = defaultGh,
  ) {
    this.available = !!Bun.which("gh");
  }

  start(): void {
    if (!this.available || this.timer) return;
    const tick = () => {
      this.runOnce().catch((e) => console.error("[pr-sync]", e));
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. While a pass runs (gh can be slow), another call joins it instead of starting a second one. */
  runOnce(): Promise<SyncResult> {
    this.running ??= this.pass().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pass(): Promise<SyncResult> {
    const result = await syncPullRequests({ gh: this.gh });
    this.lastRunAt = new Date().toISOString();
    this.lastErrors = result.errors;
    for (const id of [...result.checked, ...result.autoMerged]) {
      const task = getTasks(undefined, { includeArchived: true }).find((t) => t.id === id);
      if (task) this.broadcast("task_updated", task);
    }
    return result;
  }

  state() {
    return { available: this.available, lastRunAt: this.lastRunAt, errors: this.lastErrors };
  }
}
