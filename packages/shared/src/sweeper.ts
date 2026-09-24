/**
 * Housekeeping that keeps the queue moving without a person: expired claims of
 * silent hand-opened sessions go back to the queue, and reviews nobody eligible
 * picked up in time go to a person. Safe to call often and from any process.
 */
import { getDbHandle, getTaskById } from "./database.js";
import { TaskStatus } from "./catalog.js";
import { reviewGate } from "./policy.js";
import { policyFor, revertClaim, transitionTask, verifierOnline } from "./workflow.js";

/** Minutes a verification may wait for a verifier that stopped sending heartbeats. */
const VERIFY_WAIT_MIN = 5;

export interface SweepResult {
  /** Tasks whose claim lease expired (released back to the queue). */
  expired: string[];
  /** Reviews handed to a person because no eligible reviewer claimed them. */
  starved: string[];
  /** Verifications skipped because the verifier is gone. */
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
    const reverted = revertClaim(
      id,
      `The agent session that claimed this task showed no activity for ${minutes} min; its claim expired and the task went back to the queue.`,
    );
    if (reverted) result.expired.push(id);
  }

  const waiting = d
    .prepare(
      "SELECT id FROM tasks WHERE status = ? AND assigned_agent_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL",
    )
    .all(TaskStatus.CodeReviewRequested) as { id: string }[];
  for (const { id } of waiting) {
    const task = getTaskById(id);
    if (!task) continue;
    const limit = policyFor(task).reviewStarvationMin;
    const since = task.history.at(-1);
    if (limit <= 0 || !since || since.new_status !== TaskStatus.CodeReviewRequested) continue;
    if (now.getTime() - new Date(since.timestamp).getTime() < limit * 60_000) continue;
    transitionTask(task, TaskStatus.WaitingCodeReview, {
      actor: "system:sweeper",
      author: "system",
      message: `No eligible reviewer agent picked this review up in ${limit} min (a runner never reviews its own code). A person reviews it instead; start a reviewer runner to avoid this.`,
      messageType: "system",
      event: "review_starved",
    });
    result.starved.push(id);
  }

  // Verifications waiting for a verifier that is not running go on to review, unverified.
  if (!verifierOnline(now.getTime())) {
    const pending = d
      .prepare("SELECT id FROM tasks WHERE status = ? AND assigned_agent_id IS NULL AND deleted_at IS NULL")
      .all(TaskStatus.VerifyRequested) as { id: string }[];
    for (const { id } of pending) {
      const task = getTaskById(id);
      const since = task?.history.at(-1);
      if (!task || !since || now.getTime() - new Date(since.timestamp).getTime() < VERIFY_WAIT_MIN * 60_000) continue;
      transitionTask(task, reviewGate(policyFor(task)), {
        actor: "system:sweeper",
        author: "system",
        message: `The verifier is not running, so the code goes to review unverified (waited ${VERIFY_WAIT_MIN} min).`,
        messageType: "system",
        event: "verification_skipped",
      });
      result.unverified.push(id);
    }
  }
  return result;
}
