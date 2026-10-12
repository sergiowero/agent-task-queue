/**
 * Housekeeping that keeps the queue moving without a person: expired claims of
 * silent hand-opened sessions go back to the queue, reviews nobody eligible
 * picked up in time go to a person, and code nobody verified goes on to review,
 * marked as not verified. Safe to call often and from any process.
 */
import { getDbHandle, getTaskById } from "./database.js";
import { TaskStatus, claimRuleFor } from "./catalog.js";
import { reviewGate } from "./policy.js";
import { verifyWait } from "./verifier.js";
import { policyFor, revertClaim, transitionTask, unverifiedRecord } from "./workflow.js";

export interface SweepResult {
  /** Tasks whose claim lease expired (released back to the queue). */
  expired: string[];
  /** Reviews handed to a person because no eligible reviewer claimed them. */
  starved: string[];
  /** Code nobody verified in time (the verifier is gone, or no agent took it): it went on to review, unverified. */
  unverified: string[];
}

export function sweepQueue(now: Date = new Date()): SweepResult {
  const d = getDbHandle();
  const nowIso = now.toISOString();
  const result: SweepResult = { expired: [], starved: [], unverified: [] };

  const expired = d
    .prepare(
      "SELECT id FROM tasks WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ? AND assigned_agent_id IS NOT NULL AND deleted_at IS NULL",
    )
    .all(nowIso) as { id: string }[];
  for (const { id } of expired) {
    const task = getTaskById(id);
    if (!task) continue;
    const minutes = policyFor(task).leaseMin;
    // Its own event and actor: only a runner's lost job is a runner revert (see computeMetrics).
    const reverted = revertClaim(
      id,
      `The agent session that claimed this task showed no activity for ${minutes} min; its claim expired and the task went back to the queue.`,
      { actor: "system:sweeper", event: "lease_expired" },
    );
    if (reverted) result.expired.push(id);
  }

  // Reviews (of code or of plans) nobody eligible picked up: a person takes them.
  const starving: [TaskStatus, TaskStatus, string][] = [
    [TaskStatus.CodeReviewRequested, TaskStatus.WaitingCodeReview, "review"],
    [TaskStatus.PlanReviewRequested, TaskStatus.WaitingPlanReview, "plan critique"],
  ];
  for (const [from, to, what] of starving) {
    const waiting = d
      .prepare(
        "SELECT id FROM tasks WHERE status = ? AND assigned_agent_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL",
      )
      .all(from) as { id: string }[];
    for (const { id } of waiting) {
      const task = getTaskById(id);
      if (!task) continue;
      const limit = policyFor(task).reviewStarvationMin;
      const since = task.history.at(-1);
      if (limit <= 0 || !since || since.new_status !== from) continue;
      if (now.getTime() - new Date(since.timestamp).getTime() < limit * 60_000) continue;
      transitionTask(task, to, {
        actor: "system:sweeper",
        author: "system",
        message: `No eligible agent picked this ${what} up in ${limit} min (an agent never reviews its own work). A person does it instead; start a runner with the \`${claimRuleFor(from)?.role}\` role to avoid this.`,
        messageType: "system",
        event: "review_starved",
      });
      result.starved.push(id);
    }
  }

  // Code nobody verified goes on to review, unverified: the built-in verifier's after a few minutes
  // without its heartbeat, an agent verifier's (the project's choice, or a runner that took over)
  // only after the same wait a review has for its reviewer.
  const pending = d
    .prepare("SELECT id FROM tasks WHERE status = ? AND assigned_agent_id IS NULL AND deleted_at IS NULL")
    .all(TaskStatus.VerifyRequested) as { id: string }[];
  for (const { id } of pending) {
    const task = getTaskById(id);
    const since = task?.history.at(-1);
    if (!task || !since) continue;
    const policy = policyFor(task);
    const wait = verifyWait(task, policy, now.getTime());
    if (!wait || now.getTime() - new Date(since.timestamp).getTime() < wait.minutes * 60_000) continue;
    const [message, note] =
      wait.by === "agent"
        ? [
            `No agent with the \`verify\` role took the verification in ${wait.minutes} min (an agent never verifies its own code), so the code goes to review unverified. Start a runner with that role, or open a session with it, to avoid this.`,
            `Not verified: no verifier agent took it in ${wait.minutes} min.`,
          ]
        : [
            `The verifier is not running, so the code goes to review unverified (waited ${wait.minutes} min).`,
            `Not verified: the verifier is not running (waited ${wait.minutes} min).`,
          ];
    transitionTask(task, reviewGate(policy), {
      actor: "system:sweeper",
      author: "system",
      message,
      messageType: "system",
      event: "verification_skipped",
      patch: { verification: unverifiedRecord(task, note) },
    });
    result.unverified.push(id);
  }
  return result;
}
