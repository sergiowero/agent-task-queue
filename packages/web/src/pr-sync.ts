/**
 * Keeps tasks in `pr_open` in step with GitHub through the `gh` CLI: a merged
 * PR completes the task (and archives it when the project asks), a closed one
 * goes to a person, and under L3 a green, low-risk PR can merge itself.
 */
import type { PullRequest, Task } from "@agentq/shared";
import {
  TaskStatus,
  addActivity,
  archiveTask,
  completeFromPullRequest,
  getProjectById,
  getTasks,
  policyFor,
  pullRequestClosed,
  recordPullRequest,
  resolveProfile,
} from "@agentq/shared";

export interface GhResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[], cwd: string) => GhResult;

export const defaultGh: GhRunner = (args, cwd) => {
  try {
    const proc = Bun.spawnSync(["gh", ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    return { exitCode: proc.exitCode ?? 1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
  } catch (e: any) {
    return { exitCode: 127, stdout: "", stderr: e?.message ?? String(e) };
  }
};

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

export function parsePullRequest(json: any, previous: PullRequest | null, now: string): PullRequest {
  const state = String(json.state ?? "").toUpperCase();
  const reviewers = (json.reviews ?? [])
    .filter((r: any) => String(r.state).toUpperCase() === "CHANGES_REQUESTED")
    .map((r: any) => r.author?.login)
    .filter(Boolean);
  return {
    url: json.url ?? previous?.url ?? null,
    number: json.number ?? previous?.number ?? null,
    state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open",
    branch: json.headRefName ?? previous?.branch ?? null,
    mergedAt: json.mergedAt ?? null,
    mergedBy: json.mergedBy?.login ?? null,
    changesRequestedBy: [...new Set<string>(reviewers)],
    checks: checksOf(json.statusCheckRollup),
    checkedAt: now,
  };
}

/** One pass over every task in pr_open. */
export function syncPullRequests(opts: { gh?: GhRunner; now?: Date } = {}): SyncResult {
  const gh = opts.gh ?? defaultGh;
  const now = (opts.now ?? new Date()).toISOString();
  const result: SyncResult = { checked: [], merged: [], closed: [], autoMerged: [], errors: [] };

  for (const task of getTasks(undefined, { includeArchived: false }).filter((t) => t.status === TaskStatus.PrOpen)) {
    const project = task.projectId ? getProjectById(task.projectId) : null;
    if (!project) continue;
    const ref = prRef(task);
    const view = gh(["pr", "view", ref, "--json", FIELDS], project.workingDirectory);
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
      if (resolveProfile(project.profile).autoArchive) {
        try {
          archiveTask(task.id, { actor: "system", pullRequests: pr.url ? [pr.url] : [] });
        } catch {}
      }
      continue;
    }
    if (pr.state === "closed") {
      pullRequestClosed(task.id, pr);
      result.closed.push(task.id);
      continue;
    }
    recordPullRequest(task.id, pr);

    // L3: a green, low-risk PR nobody asked changes on merges itself.
    const policy = policyFor(task);
    if (
      policy.level === 3 &&
      policy.autoMerge &&
      task.risk === "low" &&
      pr.checks === "success" &&
      pr.changesRequestedBy.length === 0
    ) {
      const merge = gh(["pr", "merge", ref, "--squash"], project.workingDirectory);
      if (merge.exitCode === 0) {
        addActivity(task.id, "pr_auto_merged", "system", pr.url ?? ref);
        completeFromPullRequest(task.id, { ...pr, state: "merged", mergedAt: now, mergedBy: "agentq-auto-merge" });
        result.autoMerged.push(task.id);
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
      try {
        this.runOnce();
      } catch (e) {
        console.error("[pr-sync]", e);
      }
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  runOnce(): SyncResult {
    const result = syncPullRequests({ gh: this.gh });
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
