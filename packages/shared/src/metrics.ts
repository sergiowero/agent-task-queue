/**
 * How well the flow uses people's time, computed from the activity log and the
 * status history (the report's success metrics).
 */
import { getDbHandle, getTasks } from "./database.js";
import { TaskStatus } from "./catalog.js";
import type { ActivityEvent, Task } from "./types.js";

/** Activity a person causes by deciding something (comments and creation are not decisions). */
export const HUMAN_DECISIONS = new Set([
  "plan_approved",
  "plan_changes_requested",
  "code_approved",
  "code_changes_requested",
  "ai_review_requested",
  "task_completed",
  "task_canceled",
  "task_unblocked",
  "blocker_resolved",
  "draft_promoted",
]);

export interface FlowMetrics {
  tasks: number;
  /** Decisions a person made per task (target at L2: ≤ 2). */
  humanClicksPerTask: number;
  /** Share of the tasks that reached a PR with no human decision on the way (target > 70%). */
  reachedPrWithoutHuman: number;
  /** AI review rounds per task that reached a PR (target ≤ 1.5). */
  reviewRoundsAtPr: number;
  /** Share of tasks that went through needs_human (healthy: 10–20%). */
  escalationRate: number;
  /** Share of AI-approved tasks a person still sent back (target < 10%). */
  humanRejectionAfterAiApproval: number;
  /** Runner reverts per task (should drop). */
  revertsPerTask: number;
  /** Hours from creation to completion (completed tasks only). */
  leadTimeHours: number | null;
  completed: number;
  reachedPr: number;
}

export interface MetricsFilter {
  projectId?: string;
  /** ISO timestamps: tasks created in [from, to]. */
  from?: string;
  to?: string;
}

function activityFor(taskIds: string[]): Map<string, ActivityEvent[]> {
  const map = new Map<string, ActivityEvent[]>(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return map;
  const rows = getDbHandle()
    .prepare(
      `SELECT id, event_type, task_id, actor, details, created_at FROM activity WHERE task_id IN (${taskIds.map(() => "?").join(", ")}) ORDER BY created_at ASC, id ASC`,
    )
    .all(...taskIds) as any[];
  for (const r of rows) {
    map.get(r.task_id)?.push({
      id: r.id,
      eventType: r.event_type,
      taskId: r.task_id,
      actor: r.actor,
      details: r.details,
      createdAt: r.created_at,
    });
  }
  return map;
}

const ratio = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 1000);

function reachedPrAt(task: Task): string | null {
  return task.history.find((h) => h.new_status === TaskStatus.PrOpen || h.new_status === "merged")?.timestamp ?? null;
}

export function computeMetrics(filter: MetricsFilter = {}): FlowMetrics {
  const tasks = getTasks(filter.projectId, { includeArchived: true }).filter(
    (t) => (!filter.from || t.createdAt >= filter.from) && (!filter.to || t.createdAt <= filter.to),
  );
  const activity = activityFor(tasks.map((t) => t.id));

  let clicks = 0;
  let reachedPr = 0;
  let prWithoutHuman = 0;
  let roundsAtPr = 0;
  let escalated = 0;
  let aiApproved = 0;
  let rejectedAfterAi = 0;
  let reverts = 0;
  const leadTimes: number[] = [];

  for (const task of tasks) {
    const events = activity.get(task.id) ?? [];
    const decisions = events.filter((e) => e.actor === "user" && HUMAN_DECISIONS.has(e.eventType));
    clicks += decisions.length;
    reverts += events.filter((e) => e.eventType === "task_reverted").length;
    if (task.history.some((h) => h.new_status === TaskStatus.NeedsHuman)) escalated++;

    const prAt = reachedPrAt(task);
    if (prAt) {
      reachedPr++;
      roundsAtPr += task.codeRound;
      if (!decisions.some((e) => e.createdAt <= prAt)) prWithoutHuman++;
    }

    const approvals = events.filter((e) => e.eventType === "review_submitted" && e.details === "approve");
    if (approvals.length) {
      aiApproved++;
      const firstApproval = approvals[0].createdAt;
      const humanSentBack = events.some(
        (e) => e.actor === "user" && e.eventType === "code_changes_requested" && e.createdAt >= firstApproval,
      );
      if (humanSentBack || (task.pullRequest?.changesRequestedBy.length ?? 0) > 0) rejectedAfterAi++;
    }

    const done = task.history.find((h) => h.new_status === TaskStatus.Complete);
    if (done) leadTimes.push((new Date(done.timestamp).getTime() - new Date(task.createdAt).getTime()) / 3_600_000);
  }

  return {
    tasks: tasks.length,
    humanClicksPerTask: ratio(clicks, tasks.length),
    reachedPrWithoutHuman: ratio(prWithoutHuman, reachedPr),
    reviewRoundsAtPr: ratio(roundsAtPr, reachedPr),
    escalationRate: ratio(escalated, tasks.length),
    humanRejectionAfterAiApproval: ratio(rejectedAfterAi, aiApproved),
    revertsPerTask: ratio(reverts, tasks.length),
    leadTimeHours: leadTimes.length
      ? Math.round((leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) * 10) / 10
      : null,
    completed: leadTimes.length,
    reachedPr,
  };
}
