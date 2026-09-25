import { describe, it, expect } from "bun:test";
import { createProject, getSubtasks, getTaskById } from "./database.js";
import { DEFAULT_ROLES, TaskStatus, getClaimableStatuses } from "./index.js";
import { getFindings } from "./records.js";
import {
  approvePlan,
  cancelTask,
  claimNextTask,
  completeTask,
  createSubtask,
  createTaskForProject,
  promoteDraft,
  requestPlanChanges,
  submitCode,
  submitMerge,
  submitPlan,
  submitPlanReview,
  submitRefinement,
  submitReview,
} from "./workflow.js";

process.env.AGENTQ_DB_PATH = ":memory:";

const planner = { toolName: "Planner", version: "1", model: "p", sessionId: "pl-planner" };
const critic = { toolName: "Critic", version: "1", model: "c", sessionId: "pl-critic" };
const coder = { toolName: "Coder", version: "1", model: "k", sessionId: "pl-coder" };
const reviewer = { toolName: "Reviewer", version: "1", model: "r", sessionId: "pl-reviewer" };
let n = 0;

function project(extra: Record<string, unknown> = {}) {
  const id = `planning-${Date.now()}-${n++}`;
  createProject({ id, displayName: "Planning", workingDirectory: "/tmp/planning", ...extra } as any);
  return id;
}

const DESCRIPTION = "Users can export their data as CSV from the settings page.";

function planned(projectId: string, over: Record<string, unknown> = {}) {
  const task = createTaskForProject({ title: "plan me", description: DESCRIPTION, projectId, requiresPlan: true, ...over });
  const c = claimNextTask({ roles: ["plan"], agent: planner, projectId })!;
  expect(c.task.id).toBe(task.id);
  return { task, claimToken: c.claimToken };
}

function critique(projectId: string, input: Omit<Parameters<typeof submitPlanReview>[1], "claimToken">) {
  const c = claimNextTask({ roles: ["plan_review"], agent: critic, projectId })!;
  expect(c.task.status).toBe(TaskStatus.PlanReviewing);
  return submitPlanReview(c.task.id, { ...input, claimToken: c.claimToken });
}

describe("plan critique (L2)", () => {
  it("the planner's own session cannot critique; an approved low-risk plan goes straight to coding", () => {
    const pid = project();
    const { task, claimToken } = planned(pid, { risk: "low" });
    expect(submitPlan(task.id, { message: "## Plan", claimToken }).newStatus).toBe(TaskStatus.PlanReviewRequested);
    expect(claimNextTask({ roles: ["plan_review"], agent: planner, projectId: pid })).toBeNull();
    const out = critique(pid, { verdict: "approve", message: "sound" });
    expect(out.newStatus).toBe(TaskStatus.ReadyForCode);
    expect(getTaskById(task.id)!.approvedPlan).toMatchObject({ markdown: "## Plan", approvedBy: "critic@1|c" });
  });

  it("a medium-risk plan still goes to a person after the critic approves", () => {
    const pid = project();
    const { task, claimToken } = planned(pid);
    submitPlan(task.id, { message: "## Plan", claimToken });
    expect(critique(pid, { verdict: "approve", message: "ok" }).newStatus).toBe(TaskStatus.WaitingPlanReview);
    expect(approvePlan(task.id).approvedPlan?.approvedBy).toBe("user");
  });

  it("request_changes loops back to the planner with P-findings; after two rounds a person decides", () => {
    const pid = project();
    const { task, claimToken } = planned(pid);
    submitPlan(task.id, { message: "v1", claimToken });
    expect(
      critique(pid, { verdict: "request_changes", message: "no test", findings: [{ severity: "major", text: "AC1 has no check" }] }).newStatus,
    ).toBe(TaskStatus.PlanChangesRequested);
    expect(getFindings(task.id).map((f) => [f.id, f.phase])).toEqual([["P1-1", "plan"]]);
    const again = claimNextTask({ roles: ["plan"], agent: planner, projectId: pid })!;
    submitPlan(task.id, { message: "v2", claimToken: again.claimToken });
    const second = critique(pid, {
      verdict: "request_changes",
      message: "still",
      verifiedFindings: [{ id: "P1-1", status: "open" }],
    });
    expect(second.newStatus).toBe(TaskStatus.NeedsHuman);
    expect(getTaskById(task.id)!.blocker?.reason).toContain("limit 2");
  });

  it("the critic cannot approve with open blocker/major plan findings", () => {
    const pid = project();
    const { task, claimToken } = planned(pid);
    submitPlan(task.id, { message: "v1", claimToken });
    const c = claimNextTask({ roles: ["plan_review"], agent: critic, projectId: pid })!;
    expect(() =>
      submitPlanReview(task.id, { verdict: "approve", message: "x", claimToken: c.claimToken, findings: [{ severity: "blocker", text: "wrong" }] }),
    ).toThrow("open blocker or major findings: P1-1");
  });

  it("blocking questions go to a person first; the planner may raise the risk, protected paths make it high", () => {
    const pid = project({ profile: { protectedPaths: ["migrations/**"] } });
    const q = planned(pid, { risk: "low" });
    const asked = submitPlan(q.task.id, {
      message: "?",
      claimToken: q.claimToken,
      openQuestions: [{ text: "CSV or XLSX?", blocking: true }, { text: "Nice to have: dates?", blocking: false }],
    });
    expect(asked.newStatus).toBe(TaskStatus.NeedsHuman);
    expect(getTaskById(q.task.id)!.blocker?.question).toBe("CSV or XLSX?");

    const r = planned(pid, { risk: "low" });
    submitPlan(r.task.id, { message: "p", claimToken: r.claimToken, suggestedRisk: "medium", touchedPaths: ["migrations/002.sql"] });
    const raised = getTaskById(r.task.id)!;
    expect(raised.risk).toBe("high");
    expect(raised.riskReasons.join(" ")).toContain("migrations/002.sql");
    expect(raised.planSubmission).toMatchObject({ suggestedRisk: "medium", touchedPaths: ["migrations/002.sql"] });

    const s = planned(pid, { risk: "medium" });
    submitPlan(s.task.id, { message: "p", claimToken: s.claimToken, suggestedRisk: "low" });
    expect(getTaskById(s.task.id)!.risk).toBe("medium");
  });
});

describe("subtasks", () => {
  it("only the parent's planner creates them; they wait for the plan, run in order, and complete the parent", () => {
    const pid = project({ autonomy: 1 });
    const { task: parent, claimToken } = planned(pid);
    expect(() => createSubtask(parent.id, { title: "x", description: "d", claimToken: "nope" })).toThrow();
    const first = createSubtask(parent.id, { title: "Backend", description: DESCRIPTION, claimToken });
    const second = createSubtask(parent.id, { title: "UI", description: DESCRIPTION, claimToken, blockedBy: [first.id] });
    expect(first.held).toBe(true);
    submitPlan(parent.id, { message: "## Split", claimToken, proposedSubtasks: ["Backend", "UI"] });
    // Held: nothing claims them before the plan is approved.
    expect(claimNextTask({ roles: ["code"], agent: coder, projectId: pid })).toBeNull();

    expect(approvePlan(parent.id).status).toBe(TaskStatus.Split);
    expect(getSubtasks(parent.id).every((c) => !c.held)).toBe(true);

    // The UI subtask waits for the backend one.
    const c1 = claimNextTask({ roles: ["code"], agent: coder, projectId: pid })!;
    expect(c1.task.id).toBe(first.id);
    expect(claimNextTask({ roles: ["code"], agent: coder, projectId: pid })).toBeNull();
    submitCode(first.id, { message: "c", worktree: "/w", claimToken: c1.claimToken });
    const r1 = claimNextTask({ roles: ["review"], agent: reviewer, projectId: pid })!;
    submitReview(first.id, { verdict: "approve", message: "ok", claimToken: r1.claimToken });
    const m1 = claimNextTask({ roles: ["pr"], agent: coder, projectId: pid })!;
    submitMerge(first.id, { branch: "main", commit: "a", authors: "x", claimToken: m1.claimToken });
    completeTask(first.id);
    expect(getTaskById(parent.id)!.status).toBe(TaskStatus.Split);

    expect(claimNextTask({ roles: ["code"], agent: coder, projectId: pid })!.task.id).toBe(second.id);
    cancelTask(second.id);
    expect(getTaskById(parent.id)!.status).toBe(TaskStatus.Complete);
  });

  it("re-planning drops the subtasks of the previous plan", () => {
    const pid = project({ autonomy: 1 });
    const { task: parent, claimToken } = planned(pid);
    const child = createSubtask(parent.id, { title: "old idea", description: DESCRIPTION, claimToken });
    submitPlan(parent.id, { message: "v1", claimToken });
    requestPlanChanges(parent.id, { message: "different split" });
    claimNextTask({ roles: ["plan"], agent: planner, projectId: pid });
    expect(getTaskById(child.id)!.status).toBe(TaskStatus.Canceled);
  });
});

describe("drafts", () => {
  it("a refiner makes a draft ready; a blocking question goes to a person; a person can promote one", () => {
    const pid = project();
    const draft = createTaskForProject({ title: "rough", description: "export stuff", projectId: pid, draft: true });
    expect(draft.status).toBe(TaskStatus.Draft);
    const c = claimNextTask({ roles: ["refine"], agent: planner, projectId: pid })!;
    expect(c.task.status).toBe(TaskStatus.Refining);
    const out = submitRefinement(draft.id, {
      message: "made it ready",
      claimToken: c.claimToken,
      description: DESCRIPTION,
      acceptanceCriteria: ["header row $ bun test export"],
      type: "docs",
      risk: "low",
      context: "assumed CSV",
    });
    expect(out.newStatus).toBe(TaskStatus.ReadyForCode);
    expect(getTaskById(draft.id)!).toMatchObject({ risk: "low", dorIssues: [] });

    const unclear = createTaskForProject({ title: "unclear", description: "?", projectId: pid, draft: true });
    const c2 = claimNextTask({ roles: ["refine"], agent: planner, projectId: pid })!;
    const asked = submitRefinement(unclear.id, {
      message: "?",
      claimToken: c2.claimToken,
      openQuestions: [{ text: "Which data?", blocking: true }],
      context: "no idea",
    });
    expect(asked.newStatus).toBe(TaskStatus.NeedsHuman);

    const manual = createTaskForProject({ title: "manual", description: "x", projectId: pid, draft: true });
    expect(promoteDraft(manual.id).status).toBe(TaskStatus.ReadyForCode);
  });

  it("drafts skip the enforced Definition of Ready (they exist to be refined)", () => {
    const pid = project({ profile: { dorMode: "enforce" } });
    expect(() => createTaskForProject({ title: "x", description: "x", projectId: pid })).toThrow("not ready");
    expect(createTaskForProject({ title: "x", description: "x", projectId: pid, draft: true }).status).toBe(TaskStatus.Draft);
  });
});

describe("roles", () => {
  it("roles compose: an agent claims the statuses of each of its roles", () => {
    expect(getClaimableStatuses(["code", "pr"]).sort()).toEqual(
      [TaskStatus.ReadyForCode, TaskStatus.ChangesRequested, TaskStatus.Approved].sort(),
    );
    expect(getClaimableStatuses(["verify", "review"]).sort()).toEqual(
      [TaskStatus.VerifyRequested, TaskStatus.CodeReviewRequested].sort(),
    );
    const critic = getClaimableStatuses(["plan", "plan_review", "review"]);
    expect(critic).not.toContain(TaskStatus.ReadyForCode);
    expect(critic).toContain(TaskStatus.PlanReviewRequested);
    expect(getClaimableStatuses(DEFAULT_ROLES)).not.toContain(TaskStatus.VerifyRequested);
    expect(getClaimableStatuses(DEFAULT_ROLES)).toContain(TaskStatus.Draft);
    expect(getClaimableStatuses(["code"])).not.toContain(TaskStatus.Approved);
  });
});
