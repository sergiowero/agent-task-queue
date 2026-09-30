import { describe, it, expect } from "bun:test";
import { createProject, createTask, getActivityEvents, getTaskById } from "./database.js";
import { getFindings } from "./records.js";
import { renderPrBody } from "./brief.js";
import { forceStatus } from "./testing.js";
import { TaskStatus } from "./types.js";
import {
  claimNextTask,
  reportBlocker,
  requestAiReview,
  requestCodeChanges,
  requestPlanChanges,
  resolveBlocker,
  submitCode,
  submitPlan,
  submitPlanReview,
  submitReview,
} from "./workflow.js";

// Set test DB before any imports
process.env.AGENTQ_DB_PATH = ":memory:";

const coder = { toolName: "Coder", version: "1", model: "sonnet", sessionId: "d-coder" };
const reviewer = { toolName: "Reviewer", version: "1", model: "opus", sessionId: "d-reviewer" };
const planner = { toolName: "Planner", version: "1", model: "sonnet", sessionId: "d-planner" };
const critic = { toolName: "Critic", version: "1", model: "opus", sessionId: "d-critic" };

/** A project of its own, so a claim can only return this test's task. */
function project(autonomy: 0 | 1 | 2 | 3 = 2, policy: Record<string, number | boolean> = {}) {
  const id = `decisions-${Math.random().toString(36).slice(2)}`;
  createProject({ id, displayName: "Decisions", workingDirectory: "/tmp/decisions", autonomy, policy });
  return id;
}

function code(taskId: string, projectId: string, answers: "fixed" | "wontfix" | null = null) {
  const c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
  expect(c.task.id).toBe(taskId);
  const findingResolutions = getFindings(taskId)
    .filter((f) => f.status === "open")
    .map((f) => ({ id: f.id, status: answers ?? ("fixed" as const), resolution: answers === "wontfix" ? "Covered by an existing test" : "done" }));
  return submitCode(taskId, { message: "c", worktree: "/w", claimToken: c.claimToken, findingResolutions });
}

function review(taskId: string, projectId: string, input: Omit<Parameters<typeof submitReview>[1], "claimToken">) {
  const r = claimNextTask({ roles: ["review"], agent: reviewer, projectId })!;
  expect(r.task.id).toBe(taskId);
  return submitReview(taskId, { ...input, claimToken: r.claimToken });
}

/** The task's findings as [id, status], by id (findings of one round share their order in the table). */
function statuses(taskId: string) {
  return getFindings(taskId)
    .map((f) => [f.id, f.status])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/** A task the AI reviewer stopped after two rounds: R1-1 verified, R1-2 answered (fixed), R2-1 open. */
function roundLimit() {
  const projectId = project(2, { maxReviewRounds: 2 });
  const task = createTask({ title: "limit", description: "d", projectId });
  code(task.id, projectId);
  review(task.id, projectId, {
    verdict: "request_changes",
    message: "r1",
    findings: [
      { severity: "major", text: "add a test" },
      { severity: "minor", text: "rename x" },
    ],
  });
  code(task.id, projectId);
  const out = review(task.id, projectId, {
    verdict: "request_changes",
    message: "r2",
    verifiedFindings: [{ id: "R1-1", status: "verified" }],
    findings: [{ severity: "major", text: "handle empty input" }],
  });
  expect(out.newStatus).toBe(TaskStatus.NeedsHuman);
  expect(getTaskById(task.id)!.blocker).toMatchObject({ phase: "review", raisedBy: "system" });
  expect(statuses(task.id)).toEqual([
    ["R1-1", "verified"],
    ["R1-2", "fixed"],
    ["R2-1", "open"],
  ]);
  return { projectId, id: task.id };
}

/** A task whose reviewer and coder disagree: the coder answers wontfix twice, the reviewer reopens twice. */
function disagreement() {
  const projectId = project();
  const task = createTask({ title: "dispute", description: "d", projectId });
  code(task.id, projectId);
  review(task.id, projectId, { verdict: "request_changes", message: "r1", findings: [{ severity: "major", text: "add a test" }] });
  for (let round = 1; round <= 2; round++) {
    code(task.id, projectId, "wontfix");
    review(task.id, projectId, {
      verdict: "request_changes",
      message: "still needed",
      verifiedFindings: [{ id: "R1-1", status: "open" }],
    });
  }
  expect(getTaskById(task.id)!.blocker!.reason).toContain("disagree on R1-1");
  return { projectId, id: task.id };
}

describe("a person decides an escalated review", () => {
  it("reopens chosen findings and records the answer as a change request the coder must answer", () => {
    const { projectId, id } = roundLimit();
    const resolved = resolveBlocker(id, {
      answer: "Also keep the flag name.",
      targetStatus: TaskStatus.ChangesRequested,
      findingIds: ["R1-2"],
    });
    expect(resolved.status).toBe(TaskStatus.ChangesRequested);
    expect(resolved.blocker).toBeNull();
    // The answer is a finding (the round it was written in) next to the reviewer's open one.
    expect(
      getFindings(id)
        .map((f) => [f.id, f.status, f.severity, f.reopenCount])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["H2-1", "open", "major", 0],
      ["R1-1", "verified", "major", 0],
      ["R1-2", "open", "minor", 1],
      ["R2-1", "open", "major", 0],
    ]);
    expect(getFindings(id).find((f) => f.id === "H2-1")).toMatchObject({ text: "Also keep the flag name.", raisedBy: "user" });
    expect(resolved.conversation.at(-1)!.message).toContain("Reopened: R1-2");
    // Fresh rounds, and the coder has to answer all three.
    expect(resolved.roundBaseline.code).toBe(2);
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    const refused = () => submitCode(id, { message: "c", worktree: "/w", claimToken: c.claimToken });
    expect(refused).toThrow("Answer every open review finding");
    for (const finding of ["R1-2", "R2-1", "H2-1"]) expect(refused).toThrow(finding);
  });

  it("accepts a disputed finding: the coder's answer stands and the task goes on approved by the person", () => {
    const { id } = disagreement();
    const resolved = resolveBlocker(id, {
      answer: "The existing test is enough.",
      targetStatus: TaskStatus.Approved,
      waiveFindingIds: ["R1-1"],
    });
    expect(resolved.status).toBe(TaskStatus.Approved);
    expect(resolved.approval).toMatchObject({ by: "user", human: true });
    expect(getFindings(id)[0]).toMatchObject({ status: "wontfix", resolution: "Covered by an existing test (accepted by user)" });
    expect(resolved.conversation.at(-1)!.message).toContain("Accepted as they are: R1-1");
    // Approving is not a change request: nothing new for the coder.
    expect(getFindings(id).map((f) => f.id)).toEqual(["R1-1"]);
    expect(renderPrBody(resolved)).toContain("R1-1 (major) wontfix — Covered by an existing test (accepted by user)");
  });

  it("accepts some findings and sends the rest back in one answer", () => {
    const { id } = roundLimit();
    const resolved = resolveBlocker(id, {
      answer: "Handle the empty input; the rename can wait.",
      targetStatus: TaskStatus.ChangesRequested,
      waiveFindingIds: ["R2-1"],
      findingIds: ["R1-2"],
    });
    expect(statuses(id)).toEqual([
      ["H2-1", "open"],
      ["R1-1", "verified"],
      ["R1-2", "open"],
      ["R2-1", "wontfix"],
    ]);
    expect(getFindings(id).find((f) => f.id === "R2-1")!.resolution).toBe("accepted by user");
    expect(resolved.conversation.at(-1)!.message).toContain("Reopened: R1-2\nAccepted as they are: R2-1");
  });

  it("asFinding turns the answer into a finding or keeps it a plain reply; only review and verification escalations default to one", () => {
    const { id } = roundLimit();
    resolveBlocker(id, { answer: "Just try again.", targetStatus: TaskStatus.ChangesRequested, asFinding: false });
    expect(getFindings(id).map((f) => f.id)).toEqual(["R1-1", "R1-2", "R2-1"]);

    // A coder's own question is answered, not turned into a finding.
    const projectId = project();
    const task = createTask({ title: "asked", description: "d", projectId });
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    reportBlocker(task.id, { reason: "Unclear", question: "Which format?", claimToken: c.claimToken });
    resolveBlocker(task.id, { answer: "CSV only.", targetStatus: TaskStatus.ChangesRequested });
    expect(getFindings(task.id)).toEqual([]);
    const again = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    reportBlocker(task.id, { reason: "Unclear", question: "Which encoding?", claimToken: again.claimToken });
    resolveBlocker(task.id, { answer: "UTF-8.", targetStatus: TaskStatus.ChangesRequested, asFinding: true });
    expect(getFindings(task.id).map((f) => [f.id, f.text])).toEqual([["H1-1", "UTF-8."]]);

    // A verification escalation is decided like a review: the answer is a change request.
    const verifying = createTask({ title: "weakened", description: "d", projectId });
    const held = forceStatus(verifying.id, TaskStatus.Verifying);
    reportBlocker(verifying.id, { reason: "Tests weakened twice", question: "Accept them?", claimToken: held.claimToken! });
    expect(getTaskById(verifying.id)!.blocker!.phase).toBe("verify");
    resolveBlocker(verifying.id, { answer: "Restore the deleted tests.", targetStatus: TaskStatus.ChangesRequested });
    expect(getFindings(verifying.id).map((f) => [f.id, f.text])).toEqual([["H1-1", "Restore the deleted tests."]]);
  });

  it("refuses a bad choice as a whole: nothing is reopened, accepted or moved", () => {
    const { id } = roundLimit();
    const before = statuses(id);
    const attempt = (input: Partial<Parameters<typeof resolveBlocker>[1]>) =>
      resolveBlocker(id, { answer: "x", targetStatus: TaskStatus.ChangesRequested, ...input });

    expect(() => attempt({ targetStatus: TaskStatus.Approved, findingIds: ["R1-2"] })).toThrow("only be reopened when the task goes back");
    expect(() => attempt({ findingIds: ["R9-9"] })).toThrow("Unknown finding R9-9");
    expect(() => attempt({ waiveFindingIds: ["R9-9"] })).toThrow("Unknown finding R9-9");
    expect(() => attempt({ findingIds: ["R1-2"], waiveFindingIds: ["R1-2"] })).toThrow("cannot be both reopened and accepted");
    // R1-2 was answered by the coder: it is the reviewer's to verify or a person's to reopen, not to accept.
    expect(() => attempt({ waiveFindingIds: ["R1-2"] })).toThrow("R1-2 is fixed, not open");
    // A valid reopen next to an invalid accept is rolled back with it.
    expect(() => attempt({ findingIds: ["R1-2"], waiveFindingIds: ["R1-2x"] })).toThrow("Unknown finding");

    const task = getTaskById(id)!;
    expect(task.status).toBe(TaskStatus.NeedsHuman);
    expect(statuses(id)).toEqual(before);
  });

  it("goes back to the planner with plan findings, and refuses code findings there", () => {
    const { id } = roundLimit();
    expect(() => resolveBlocker(id, { answer: "re-plan", targetStatus: TaskStatus.PlanChangesRequested, findingIds: ["R1-2"] })).toThrow(
      "Finding R1-2 is a code finding",
    );
    expect(resolveBlocker(id, { answer: "re-plan", targetStatus: TaskStatus.PlanChangesRequested }).status).toBe(TaskStatus.PlanChangesRequested);
  });

  it("request_code_changes refuses a plan finding", () => {
    const projectId = project(0);
    const task = createTask({ title: "l0", description: "d", projectId });
    code(task.id, projectId);
    expect(() => requestCodeChanges(task.id, { message: "x", findingIds: ["P1-1"] })).toThrow("Unknown finding P1-1");
  });
});

describe("a person's answer to a plan", () => {
  /** A medium-risk plan the critic approved after one round: P1-1 (major) fixed and verified, waiting for a person. */
  function planForApproval() {
    const projectId = project();
    const task = createTask({ title: "plan", description: "d", projectId, requiresPlan: true });
    let p = claimNextTask({ roles: ["plan"], agent: planner, projectId })!;
    submitPlan(task.id, { message: "## Plan v1", claimToken: p.claimToken, context: "v1" });
    let c = claimNextTask({ roles: ["plan_review"], agent: critic, projectId })!;
    submitPlanReview(task.id, {
      verdict: "request_changes",
      message: "needs work",
      claimToken: c.claimToken,
      findings: [{ severity: "major", text: "no rollback step" }],
    });
    p = claimNextTask({ roles: ["plan"], agent: planner, projectId })!;
    submitPlan(task.id, {
      message: "## Plan v2",
      claimToken: p.claimToken,
      context: "v2",
      findingResolutions: [{ id: "P1-1", status: "fixed", resolution: "added a rollback step" }],
    });
    c = claimNextTask({ roles: ["plan_review"], agent: critic, projectId })!;
    submitPlanReview(task.id, {
      verdict: "approve",
      message: "ok",
      claimToken: c.claimToken,
      verifiedFindings: [{ id: "P1-1", status: "verified" }],
    });
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.WaitingPlanReview);
    return { projectId, id: task.id };
  }

  it("Request changes reopens the chosen plan findings: the planner answers them again", () => {
    const { projectId, id } = planForApproval();
    const out = requestPlanChanges(id, { message: "The rollback step is not enough.", findingIds: ["P1-1"] });
    expect(out.status).toBe(TaskStatus.PlanChangesRequested);
    expect(getFindings(id)[0]).toMatchObject({ id: "P1-1", status: "open", reopenCount: 1 });
    expect(out.conversation.at(-1)!.message).toBe("The rollback step is not enough.\n\nReopened: P1-1");
    const p = claimNextTask({ roles: ["plan"], agent: planner, projectId })!;
    expect(() => submitPlan(id, { message: "## Plan v3", claimToken: p.claimToken, context: "v3" })).toThrow(
      "Answer every open plan finding in findingResolutions (fixed, or wontfix with a reason): P1-1",
    );
  });

  it("refuses a code finding, an unknown id and a task that is not waiting for a plan decision, and records nothing", () => {
    const { id } = planForApproval();
    expect(() => requestPlanChanges(id, { message: "x", findingIds: ["R1-1"] })).toThrow("Unknown finding R1-1");
    expect(getTaskById(id)!.status).toBe(TaskStatus.WaitingPlanReview);

    const projectId = project(0);
    const other = createTask({ title: "ready", description: "d", projectId });
    expect(() => requestPlanChanges(other.id, { message: "x" })).toThrow("task must be in Plan review status");
    // The failed call left no handoff behind.
    expect(getTaskById(other.id)!.contexts).toEqual([]);
  });

  it("resolving a plan blocker back to the planner reopens plan findings", () => {
    const { projectId, id } = planForApproval();
    // A blocking question sends the next revision to a person, who sends it back with P1-1 reopened.
    requestPlanChanges(id, { message: "again" });
    const p = claimNextTask({ roles: ["plan"], agent: planner, projectId })!;
    submitPlan(id, {
      message: "## Plan v3",
      claimToken: p.claimToken,
      context: "v3",
      openQuestions: [{ text: "Which region?", blocking: true }],
    });
    expect(getTaskById(id)!.status).toBe(TaskStatus.NeedsHuman);
    const resolved = resolveBlocker(id, { answer: "eu-west-1", targetStatus: TaskStatus.PlanChangesRequested, findingIds: ["P1-1"] });
    expect(resolved.status).toBe(TaskStatus.PlanChangesRequested);
    expect(getFindings(id)[0]).toMatchObject({ id: "P1-1", status: "open" });
    // A plan answer is not a code finding.
    expect(getFindings(id).map((f) => f.id)).toEqual(["P1-1"]);
  });
});

describe("the AI reviewer's question under L0", () => {
  function l0Review(risk: "medium" | "high" = "medium") {
    const projectId = project(0);
    const task = createTask({ title: "supervised", description: "d", projectId, risk });
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    expect(submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken }).newStatus).toBe(TaskStatus.WaitingCodeReview);
    expect(requestAiReview(task.id).status).toBe(TaskStatus.CodeReviewRequested);
    return { projectId, id: task.id };
  }

  it("stays with the task: a conversation note, an activity event and lastReview", () => {
    const { projectId, id } = l0Review();
    const out = review(id, projectId, {
      verdict: "needs_human",
      message: "I cannot tell.",
      question: "Should the flag default to on?",
      findings: [{ severity: "minor", text: "rename x" }],
    });
    // L0: the verdict is advice, the task goes back to the person...
    expect(out.newStatus).toBe(TaskStatus.WaitingCodeReview);
    const task = getTaskById(id)!;
    expect(task.blocker).toBeNull();
    // ...who now sees what the reviewer asked.
    const last = task.conversation.at(-1)!;
    expect(last.messageType).toBe("system");
    expect(last.message).toContain("The AI reviewer could not decide and asks: Should the flag default to on?");
    expect(last.message).toContain("Open findings: R1-1 (minor)");
    expect(task.lastReview).toMatchObject({ verdict: "needs_human", question: "Should the flag default to on?" });
    expect(getActivityEvents({ taskId: id }).some((e) => e.eventType === "review_escalated")).toBe(true);
  });

  it("an approval or a change request under L0 adds no note", () => {
    const { projectId, id } = l0Review();
    review(id, projectId, { verdict: "approve", message: "LGTM" });
    const task = getTaskById(id)!;
    expect(task.status).toBe(TaskStatus.WaitingCodeReview);
    expect(task.conversation.at(-1)!.messageType).toBe("review");
    expect(task.lastReview!.question).toBeUndefined();
  });

  it("above L0 the question is the blocker's, with no second note", () => {
    const projectId = project();
    const task = createTask({ title: "asks", description: "d", projectId });
    code(task.id, projectId);
    review(task.id, projectId, { verdict: "needs_human", message: "?", question: "Ship it?" });
    const stopped = getTaskById(task.id)!;
    expect(stopped.status).toBe(TaskStatus.NeedsHuman);
    expect(stopped.blocker).toMatchObject({ question: "Ship it?", phase: "review" });
    expect(stopped.conversation.filter((e) => e.messageType === "system")).toEqual([]);
  });
});
