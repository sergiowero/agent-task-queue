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
  // An AI critic reviews the plan; a person still approves it unless the task is low risk.
  2: { plan: "agent", code: "agent" },
  3: { plan: "agent", code: "agent" },
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

/** After submit_plan. A blocking open question goes to a person before anything else. */
export function afterPlan(_task: RoutingTask, p: GatePolicy, opts: { blockingQuestions?: boolean } = {}): TaskStatus {
  if (opts.blockingQuestions) return TaskStatus.NeedsHuman;
  if (p.plan === "agent") return TaskStatus.PlanReviewRequested;
  if (p.plan === "human") return TaskStatus.WaitingPlanReview;
  return TaskStatus.ReadyForCode;
}

/** Plan critiques counted against the limit: those since the last human reset. */
export function planRoundsUsed(task: RoutingTask): number {
  return task.planRound - (task.roundBaseline.plan ?? 0);
}

export interface PlanReviewRouting {
  status: TaskStatus;
  reason?: "round_limit" | "needs_human" | "risk";
}

/**
 * After submit_plan_review. `task.planRound` already counts this critique.
 * An approved low-risk plan goes straight to coding; otherwise a person approves it.
 */
export function afterPlanReview(task: RoutingTask, p: GatePolicy, verdict: Verdict): PlanReviewRouting {
  if (verdict === "needs_human") return { status: TaskStatus.NeedsHuman, reason: "needs_human" };
  if (verdict === "request_changes") {
    return planRoundsUsed(task) >= p.maxPlanRounds
      ? { status: TaskStatus.NeedsHuman, reason: "round_limit" }
      : { status: TaskStatus.PlanChangesRequested };
  }
  return task.risk === "low"
    ? { status: TaskStatus.ReadyForCode }
    : { status: TaskStatus.WaitingPlanReview, reason: "risk" };
}

/** Where reviewed-for-correctness code goes next: a person (L0) or an AI reviewer. */
export function reviewGate(p: GatePolicy): TaskStatus {
  return p.code === "human" ? TaskStatus.WaitingCodeReview : TaskStatus.CodeReviewRequested;
}

/**
 * After submit_code. With commands to run and the verifier up, the code is
 * verified first; otherwise it goes straight to review.
 */
export function afterCode(_task: RoutingTask, p: GatePolicy, opts: { verify?: boolean } = {}): TaskStatus {
  return opts.verify ? TaskStatus.VerifyRequested : reviewGate(p);
}

/** After the verifier ran. `task.verifyFailures` already counts this run when it failed. */
export function afterVerify(task: RoutingTask, p: GatePolicy, passed: boolean): TaskStatus {
  if (!passed) {
    return task.verifyFailures >= p.maxVerifyFailures ? TaskStatus.NeedsHuman : TaskStatus.ChangesRequested;
  }
  return reviewGate(p);
}

export interface ReviewRouting {
  status: TaskStatus;
  /** Why the task did not simply follow the verdict (shown in the conversation). */
  reason?: "supervised" | "round_limit" | "high_risk" | "sampled" | "needs_human" | "disagreement";
}

/**
 * After submit_review. `task.codeRound` already counts this review.
 * L0 keeps today's behaviour: the verdict is advice and a person decides.
 */
export function afterReview(
  task: RoutingTask,
  p: GatePolicy,
  verdict: Verdict,
  opts: { sampled?: boolean; disagreement?: boolean } = {},
): ReviewRouting {
  if (p.code === "human") return { status: TaskStatus.WaitingCodeReview, reason: "supervised" };
  if (verdict === "needs_human") return { status: TaskStatus.NeedsHuman, reason: "needs_human" };
  if (verdict === "request_changes") {
    if (opts.disagreement) return { status: TaskStatus.NeedsHuman, reason: "disagreement" };
    return reviewRoundsUsed(task) >= p.maxReviewRounds
      ? { status: TaskStatus.NeedsHuman, reason: "round_limit" }
      : { status: TaskStatus.ChangesRequested };
  }
  if (task.risk === "high") return { status: TaskStatus.WaitingCodeReview, reason: "high_risk" };
  if (opts.sampled) return { status: TaskStatus.WaitingCodeReview, reason: "sampled" };
  return { status: TaskStatus.Approved };
}
