/**
 * Where a task goes after each submission, from its autonomy level, risk,
 * round and the reviewer's verdict. Pure functions over plain data, so every
 * level × verdict × risk × round combination is testable in a table.
 */
import {
  DEFAULT_AUTONOMY,
  TaskStatus,
  type AutonomyLevel,
  type Risk,
  type Verdict,
} from "./catalog.js";

/** Who decides a gate: a person, an agent (reviewer/critic), or nobody. */
export type Gate = "human" | "agent" | "none";

/** Per-project knobs, stored as JSON on the project (missing keys use the defaults). */
export interface PolicySettings {
  /** Plan critiques that may ask for changes before a person decides. */
  maxPlanRounds: number;
  /** AI code reviews that may ask for changes before a person decides. */
  maxReviewRounds: number;
  /** Consecutive red verifications before a person decides. */
  maxVerifyFailures: number;
  /** The reviewer must use a different model than the coder. */
  requireDifferentModel: boolean;
  /** Every Nth AI approval in the project also goes to a person (0 = never). */
  humanSampleEvery: number;
  /** Minutes a review may wait for an eligible reviewer before a person takes it (0 = never). */
  reviewStarvationMin: number;
  /** Minutes a hand-opened agent session may stay silent before its claim expires. */
  leaseMin: number;
  /** L3 only: merge a green, low-risk PR without a person. */
  autoMerge: boolean;
}

export const DEFAULT_POLICY: PolicySettings = {
  maxPlanRounds: 2,
  maxReviewRounds: 3,
  maxVerifyFailures: 2,
  requireDifferentModel: false,
  humanSampleEvery: 0,
  reviewStarvationMin: 20,
  leaseMin: 90,
  autoMerge: false,
};

export interface GatePolicy extends PolicySettings {
  level: AutonomyLevel;
  /** Who approves plans. */
  plan: Gate;
  /** Who reviews code. */
  code: Gate;
}

/** The gates each level puts on plans and code. A person always merges the PR (except L3 auto-merge). */
export const LEVEL_GATES: Record<AutonomyLevel, { plan: Gate; code: Gate }> = {
  0: { plan: "human", code: "human" },
  1: { plan: "human", code: "agent" },
  2: { plan: "human", code: "agent" },
  3: { plan: "human", code: "agent" },
};

export interface PolicyProject {
  autonomy?: AutonomyLevel | null;
  policy?: Partial<PolicySettings> | null;
}

export interface PolicyTask {
  autonomy?: AutonomyLevel | null;
}

export function resolvePolicy(project: PolicyProject | null | undefined, task?: PolicyTask | null): GatePolicy {
  const level = (task?.autonomy ?? project?.autonomy ?? DEFAULT_AUTONOMY) as AutonomyLevel;
  return { ...DEFAULT_POLICY, ...(project?.policy ?? {}), level, ...LEVEL_GATES[level] };
}

/** The round counters and risk the routing looks at. */
export interface RoutingTask {
  risk: Risk;
  planRound: number;
  codeRound: number;
  verifyFailures: number;
  roundBaseline: { plan?: number; code?: number };
}

/** Reviews counted against the limit: those since the last time a person reset it. */
export function reviewRoundsUsed(task: RoutingTask): number {
  return task.codeRound - (task.roundBaseline.code ?? 0);
}

/** After submit_plan. */
export function afterPlan(_task: RoutingTask, p: GatePolicy): TaskStatus {
  return p.plan === "none" ? TaskStatus.ReadyForCode : TaskStatus.WaitingPlanReview;
}

/** After submit_code (verification is added in a later phase). */
export function afterCode(_task: RoutingTask, p: GatePolicy): TaskStatus {
  return p.code === "human" ? TaskStatus.WaitingCodeReview : TaskStatus.CodeReviewRequested;
}

export interface ReviewRouting {
  status: TaskStatus;
  /** Why the task did not simply follow the verdict (shown in the conversation). */
  reason?: "supervised" | "round_limit" | "high_risk" | "sampled" | "needs_human";
}

/**
 * After submit_review. `task.codeRound` already counts this review.
 * L0 keeps today's behaviour: the verdict is advice and a person decides.
 */
export function afterReview(
  task: RoutingTask,
  p: GatePolicy,
  verdict: Verdict,
  opts: { sampled?: boolean } = {},
): ReviewRouting {
  if (p.code === "human") return { status: TaskStatus.WaitingCodeReview, reason: "supervised" };
  if (verdict === "needs_human") return { status: TaskStatus.NeedsHuman, reason: "needs_human" };
  if (verdict === "request_changes") {
    return reviewRoundsUsed(task) >= p.maxReviewRounds
      ? { status: TaskStatus.NeedsHuman, reason: "round_limit" }
      : { status: TaskStatus.ChangesRequested };
  }
  if (task.risk === "high") return { status: TaskStatus.WaitingCodeReview, reason: "high_risk" };
  if (opts.sampled) return { status: TaskStatus.WaitingCodeReview, reason: "sampled" };
  return { status: TaskStatus.Approved };
}
