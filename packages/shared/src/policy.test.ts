import { describe, it, expect } from "bun:test";
import { TaskStatus, type AutonomyLevel, type Risk, type Verdict } from "./catalog.js";
import {
  DEFAULT_POLICY,
  afterCode,
  afterPlan,
  afterPlanReview,
  afterReview,
  resolvePolicy,
  type RoutingTask,
} from "./policy.js";

const task = (over: Partial<RoutingTask> = {}): RoutingTask => ({
  risk: "medium",
  planRound: 0,
  codeRound: 1,
  verifyFailures: 0,
  roundBaseline: {},
  ...over,
});

describe("resolvePolicy", () => {
  it("defaults to L2 and the default settings", () => {
    const p = resolvePolicy(null);
    expect(p.level).toBe(2);
    expect(p).toMatchObject({ ...DEFAULT_POLICY, plan: "agent", code: "agent" });
  });

  it("a task override beats the project level; project settings override defaults", () => {
    const p = resolvePolicy({ autonomy: 2, policy: { maxReviewRounds: 5 } }, { autonomy: 0 });
    expect(p.level).toBe(0);
    expect(p.code).toBe("human");
    expect(p.maxReviewRounds).toBe(5);
  });
});

describe("routing", () => {
  it("plans go to a person under L0/L1 and to an AI critic from L2; blocking questions go to a person first", () => {
    expect(afterPlan(task(), resolvePolicy({ autonomy: 0 }))).toBe(TaskStatus.WaitingPlanReview);
    expect(afterPlan(task(), resolvePolicy({ autonomy: 1 }))).toBe(TaskStatus.WaitingPlanReview);
    expect(afterPlan(task(), resolvePolicy({ autonomy: 2 }))).toBe(TaskStatus.PlanReviewRequested);
    expect(afterPlan(task(), resolvePolicy({ autonomy: 3 }))).toBe(TaskStatus.PlanReviewRequested);
    expect(afterPlan(task(), resolvePolicy({ autonomy: 2 }), { blockingQuestions: true })).toBe(TaskStatus.NeedsHuman);
  });

  it("the critic's verdict: low risk goes to coding, higher risk to a person, changes back to the planner", () => {
    const p = resolvePolicy({ autonomy: 2 });
    expect(afterPlanReview(task({ risk: "low", planRound: 1 }), p, "approve").status).toBe(TaskStatus.ReadyForCode);
    expect(afterPlanReview(task({ risk: "medium", planRound: 1 }), p, "approve")).toEqual({
      status: TaskStatus.WaitingPlanReview,
      reason: "risk",
    });
    expect(afterPlanReview(task({ planRound: 1 }), p, "request_changes").status).toBe(TaskStatus.PlanChangesRequested);
    expect(afterPlanReview(task({ planRound: 2 }), p, "request_changes")).toEqual({
      status: TaskStatus.NeedsHuman,
      reason: "round_limit",
    });
    expect(afterPlanReview(task(), p, "needs_human").status).toBe(TaskStatus.NeedsHuman);
  });

  it("code goes to a person at L0 and to an AI reviewer from L1", () => {
    expect(afterCode(task(), resolvePolicy({ autonomy: 0 }))).toBe(TaskStatus.WaitingCodeReview);
    for (const level of [1, 2, 3] as AutonomyLevel[]) {
      expect(afterCode(task(), resolvePolicy({ autonomy: level }))).toBe(TaskStatus.CodeReviewRequested);
    }
  });

  const cases: [AutonomyLevel, Verdict, Risk, number, boolean, TaskStatus][] = [
    // L0 keeps today's behaviour: every verdict goes to a person.
    [0, "approve", "low", 1, false, TaskStatus.WaitingCodeReview],
    [0, "request_changes", "medium", 3, false, TaskStatus.WaitingCodeReview],
    [0, "needs_human", "medium", 1, false, TaskStatus.WaitingCodeReview],
    // L1+: the verdict routes.
    [2, "approve", "low", 1, false, TaskStatus.Approved],
    [2, "approve", "medium", 2, false, TaskStatus.Approved],
    [2, "approve", "high", 1, false, TaskStatus.WaitingCodeReview],
    [2, "approve", "medium", 1, true, TaskStatus.WaitingCodeReview],
    [2, "request_changes", "medium", 1, false, TaskStatus.ChangesRequested],
    [2, "request_changes", "medium", 2, false, TaskStatus.ChangesRequested],
    [2, "request_changes", "medium", 3, false, TaskStatus.NeedsHuman],
    [2, "needs_human", "low", 1, false, TaskStatus.NeedsHuman],
    [1, "approve", "medium", 1, false, TaskStatus.Approved],
    [3, "request_changes", "low", 3, false, TaskStatus.NeedsHuman],
  ];
  for (const [level, verdict, risk, round, sampled, expected] of cases) {
    it(`L${level} ${verdict} (risk ${risk}, round ${round}${sampled ? ", sampled" : ""}) -> ${expected}`, () => {
      const routed = afterReview(task({ risk, codeRound: round }), resolvePolicy({ autonomy: level }), verdict, { sampled });
      expect(routed.status).toBe(expected);
    });
  }

  it("the round limit counts from the last human reset", () => {
    const p = resolvePolicy({ autonomy: 2 });
    expect(afterReview(task({ codeRound: 5, roundBaseline: { code: 3 } }), p, "request_changes").status).toBe(
      TaskStatus.ChangesRequested,
    );
    expect(afterReview(task({ codeRound: 6, roundBaseline: { code: 3 } }), p, "request_changes")).toEqual({
      status: TaskStatus.NeedsHuman,
      reason: "round_limit",
    });
  });
});
