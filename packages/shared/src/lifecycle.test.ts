import { describe, it, expect } from "bun:test";
import { createProject, getSubtasks, getTaskById, patchTask, softDeleteTask } from "./database.js";
import { TaskStatus, criteriaEditable, inboxReason } from "./catalog.js";
import { forceStatus } from "./testing.js";
import {
  approvePlan,
  cancelTask,
  claimNextTask,
  completeTask,
  createSubtask,
  createTaskForProject,
  dependencyDeleted,
  editTask,
  reportBlocker,
  requestPlanChanges,
  requestReplan,
  resolveBlocker,
  submitPlan,
  submitPlanReview,
  submitRefinement,
} from "./workflow.js";

process.env.AGENTQ_DB_PATH = ":memory:";

const planner = { toolName: "Planner", version: "1", model: "p", sessionId: "lc-planner" };
const critic = { toolName: "Critic", version: "1", model: "c", sessionId: "lc-critic" };
const coder = { toolName: "Coder", version: "1", model: "k", sessionId: "lc-coder" };
let n = 0;

function project(extra: Partial<Parameters<typeof createProject>[0]> = {}) {
  const id = `lifecycle-${Date.now()}-${n++}`;
  // L1: a person approves plans.
  createProject({ id, displayName: "Lifecycle", workingDirectory: "/tmp/lifecycle", autonomy: 1, ...extra });
  return id;
}

const DESCRIPTION = "Users can export their data as CSV from the settings page.";

/** A task whose plan (validating AC1) was submitted and waits for a person. */
function planSubmitted(projectId: string, over: Record<string, unknown> = {}) {
  const task = createTaskForProject({
    title: "plan me",
    description: DESCRIPTION,
    projectId,
    requiresPlan: true,
    acceptanceCriteria: ["exports a header row $ bun test export", "shows a download button"],
    ...over,
  });
  const c = claimNextTask({ roles: ["plan"], agent: planner, projectId })!;
  expect(c.task.id).toBe(task.id);
  submitPlan(task.id, {
    message: "## Plan",
    claimToken: c.claimToken,
    validationPlan: {
      items: [
        { criterionId: "AC1", how: "unit test", command: "bun test export" },
        { criterionId: "AC2", how: "manual check" },
      ],
      regressionCommands: [],
    },
  });
  return getTaskById(task.id)!;
}

describe("editing a task", () => {
  it("is refused while an agent holds the task, and in finished statuses", () => {
    const pid = project();
    const task = createTaskForProject({ title: "held", description: DESCRIPTION, projectId: pid, risk: "high", requiresPlan: true });
    for (const status of [TaskStatus.Planning, TaskStatus.Coding, TaskStatus.Verifying, TaskStatus.Reviewing, TaskStatus.Merging]) {
      forceStatus(task.id, status);
      expect(() => editTask(task.id, { risk: "low" })).toThrow("unblock it before editing");
    }
    forceStatus(task.id, TaskStatus.PrOpen);
    expect(() => editTask(task.id, { title: "x" })).toThrow("PR open cannot be edited");
    forceStatus(task.id, TaskStatus.Complete);
    expect(() => editTask(task.id, { title: "x" })).toThrow("cannot be edited");
    expect(getTaskById(task.id)).toMatchObject({ title: "held", risk: "high" });
    forceStatus(task.id, TaskStatus.VerifyRequested);
    expect(editTask(task.id, { title: "edited" }).title).toBe("edited");
  });

  it("freezes the criteria with the approved plan; other fields stay editable", () => {
    const pid = project();
    const task = planSubmitted(pid);
    // Waiting for the plan's approval: the criteria can still change.
    expect(criteriaEditable(task)).toBe(true);
    const reworded = editTask(task.id, { acceptanceCriteria: ["exports a header row $ bun test export", "shows a download link"] });
    // Reworded in place: the ids the validation plan names still point at the same criteria.
    expect(reworded.acceptanceCriteria.map((c) => [c.id, c.text])).toEqual([
      ["AC1", "exports a header row"],
      ["AC2", "shows a download link"],
    ]);
    const approved = approvePlan(task.id);
    expect(approved.status).toBe(TaskStatus.ReadyForCode);
    expect(criteriaEditable(approved)).toBe(false);
    expect(() => editTask(task.id, { acceptanceCriteria: ["anything $ rm -rf /"] })).toThrow("frozen with the approved plan");
    expect(editTask(task.id, { title: "renamed" }).acceptanceCriteria.map((c) => c.text)).toEqual([
      "exports a header row",
      "shows a download link",
    ]);
    // A person sent it back to planning: the criteria can change again.
    forceStatus(task.id, TaskStatus.PlanChangesRequested);
    expect(editTask(task.id, { acceptanceCriteria: ["exports a header row $ bun test export"] }).acceptanceCriteria).toHaveLength(1);
  });

  it("a blocked task's criteria follow the phase it was blocked in", () => {
    expect(criteriaEditable({ status: TaskStatus.NeedsHuman, approvedPlan: {}, blocker: { phase: "plan" } })).toBe(true);
    expect(criteriaEditable({ status: TaskStatus.NeedsHuman, approvedPlan: {}, blocker: { phase: "code" } })).toBe(false);
    expect(criteriaEditable({ status: TaskStatus.NeedsHuman, approvedPlan: null, blocker: { phase: "code" } })).toBe(true);
    expect(criteriaEditable({ status: TaskStatus.Coding, approvedPlan: null })).toBe(false);
  });
});

/** A planning task (claimed by the planner) with two subtasks: `second` starts after `first`. */
function splitting(projectId: string) {
  const parent = createTaskForProject({ title: "split me", description: DESCRIPTION, projectId, requiresPlan: true });
  const c = claimNextTask({ roles: ["plan"], agent: planner, projectId })!;
  expect(c.task.id).toBe(parent.id);
  const first = createSubtask(parent.id, { title: "Backend", description: DESCRIPTION, claimToken: c.claimToken });
  const second = createSubtask(parent.id, { title: "UI", description: DESCRIPTION, claimToken: c.claimToken, blockedBy: [first.id] });
  return { parent, first, second, claimToken: c.claimToken };
}

describe("a plan sent on by resolving its blocker", () => {
  it("a blocking question answered with Ready for code approves the plan and releases its subtasks", () => {
    const pid = project();
    const { parent, first, claimToken } = splitting(pid);
    submitPlan(parent.id, {
      message: "## Split",
      claimToken,
      validationPlan: { items: [], regressionCommands: ["bun test all"] },
      openQuestions: [{ text: "CSV or XLSX?", blocking: true }],
    });
    expect(getTaskById(parent.id)!.status).toBe(TaskStatus.NeedsHuman);

    const resolved = resolveBlocker(parent.id, { answer: "CSV", targetStatus: TaskStatus.ReadyForCode });
    expect(resolved.status).toBe(TaskStatus.Split);
    expect(resolved.approvedPlan).toMatchObject({ markdown: "## Split", approvedBy: "user", validation: { regressionCommands: ["bun test all"] } });
    expect(getSubtasks(parent.id).every((c) => !c.held)).toBe(true);
    expect(claimNextTask({ roles: ["code"], agent: coder, projectId: pid })!.task.id).toBe(first.id);
  });

  it("a plan-critique blocker sent to Ready for code freezes the plan too", () => {
    const pid = project({ autonomy: 2 });
    const task = createTaskForProject({ title: "critique me", description: DESCRIPTION, projectId: pid, requiresPlan: true });
    const p = claimNextTask({ roles: ["plan"], agent: planner, projectId: pid })!;
    submitPlan(task.id, { message: "## Plan", claimToken: p.claimToken });
    const r = claimNextTask({ roles: ["plan_review"], agent: critic, projectId: pid })!;
    submitPlanReview(task.id, { verdict: "needs_human", question: "Is a new table OK?", claimToken: r.claimToken });
    expect(getTaskById(task.id)!.blocker?.phase).toBe("plan_review");

    const resolved = resolveBlocker(task.id, { answer: "yes", targetStatus: TaskStatus.ReadyForCode });
    expect(resolved.status).toBe(TaskStatus.ReadyForCode);
    expect(resolved.approvedPlan).toMatchObject({ markdown: "## Plan", approvedBy: "user" });
  });

  it("a re-plan without subtasks goes to coding; the dropped subtasks of the old plan stay out", () => {
    const pid = project();
    const { parent, first, claimToken } = splitting(pid);
    submitPlan(parent.id, { message: "## Split", claimToken });
    requestPlanChanges(parent.id, { message: "one task is enough" });
    const c = claimNextTask({ roles: ["plan"], agent: planner, projectId: pid })!;
    expect(getTaskById(first.id)!.status).toBe(TaskStatus.Canceled);
    submitPlan(parent.id, { message: "## One task", claimToken: c.claimToken });
    expect(getTaskById(parent.id)!.planSubmission!.sizeWarnings).toEqual([]);
    expect(approvePlan(parent.id).status).toBe(TaskStatus.ReadyForCode);
  });

  it("a subtask after one a person canceled before the approval goes to a person when released", () => {
    const pid = project();
    const { parent, first, second, claimToken } = splitting(pid);
    submitPlan(parent.id, { message: "## Split", claimToken });
    cancelTask(first.id);
    expect(getTaskById(second.id)!.status).toBe(TaskStatus.ReadyForCode);
    expect(approvePlan(parent.id).status).toBe(TaskStatus.Split);
    expect(getTaskById(second.id)).toMatchObject({ status: TaskStatus.NeedsHuman, held: false });
    expect(getTaskById(second.id)!.blocker!.reason).toContain("which was canceled");
  });

  it("a revision without a validation plan clears the previous one", () => {
    const pid = project();
    const task = createTaskForProject({ title: "revise me", description: DESCRIPTION, projectId: pid, requiresPlan: true });
    let c = claimNextTask({ roles: ["plan"], agent: planner, projectId: pid })!;
    submitPlan(task.id, { message: "## v1", claimToken: c.claimToken, validationPlan: { items: [], regressionCommands: ["bun test old"] } });
    requestPlanChanges(task.id, { message: "simpler" });
    c = claimNextTask({ roles: ["plan"], agent: planner, projectId: pid })!;
    submitPlan(task.id, { message: "## v2", claimToken: c.claimToken });
    expect(approvePlan(task.id).approvedPlan).toMatchObject({ markdown: "## v2", validation: null });
  });
});

describe("back to planning from coding, verification or review", () => {
  it("a coder's blocker can send the task back to planning; the next approval replaces the plan", () => {
    const pid = project();
    const task = planSubmitted(pid);
    approvePlan(task.id);
    const { claimToken } = forceStatus(task.id, TaskStatus.Coding);
    reportBlocker(task.id, { reason: "export.test.ts cannot exist", question: "Re-plan?", claimToken: claimToken! });
    forceVerifyFailures(task.id, 2);

    const back = resolveBlocker(task.id, { answer: "re-plan it", targetStatus: TaskStatus.PlanChangesRequested });
    expect(back.status).toBe(TaskStatus.PlanChangesRequested);
    expect(back.verifyFailures).toBe(0);
    expect(back.approvedPlan?.validation?.items[0].command).toBe("bun test export");
    expect(criteriaEditable(back)).toBe(true);

    const c = claimNextTask({ roles: ["plan"], agent: planner, projectId: pid })!;
    submitPlan(task.id, {
      message: "## v2",
      claimToken: c.claimToken,
      validationPlan: {
        items: [
          { criterionId: "AC1", how: "unit test", command: "bun test csv" },
          { criterionId: "AC2", how: "manual check" },
        ],
        regressionCommands: [],
      },
    });
    expect(approvePlan(task.id).approvedPlan?.validation?.items[0].command).toBe("bun test csv");
  });

  it("a person reviewing the code can send it back to planning", () => {
    const pid = project();
    const task = planSubmitted(pid);
    approvePlan(task.id);
    forceStatus(task.id, TaskStatus.WaitingCodeReview);
    const back = requestReplan(task.id, { message: "the plan misses the API" });
    expect(back.status).toBe(TaskStatus.PlanChangesRequested);
    expect(back.approvedPlan).not.toBeNull();
    expect(() => requestReplan(task.id)).toThrow("Code review");
  });
});

describe("canceling", () => {
  it("a split task's subtasks are canceled with it, claimed ones included", () => {
    const pid = project();
    const { parent, first, second, claimToken } = splitting(pid);
    submitPlan(parent.id, { message: "## Split", claimToken });
    approvePlan(parent.id);
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId: pid })!;
    expect(c.task.id).toBe(first.id);

    cancelTask(parent.id);
    expect(getTaskById(first.id)!.status).toBe(TaskStatus.Canceled);
    expect(getTaskById(first.id)!.claimToken).toBeNull();
    // Canceled with its parent: not sent to a person for its canceled dependency.
    expect(getTaskById(second.id)).toMatchObject({ status: TaskStatus.Canceled, blocker: null });
  });

  it("a task being planned drops the subtasks it proposed", () => {
    const pid = project();
    const { parent, first, second } = splitting(pid);
    cancelTask(parent.id);
    expect([getTaskById(first.id)!.status, getTaskById(second.id)!.status]).toEqual([TaskStatus.Canceled, TaskStatus.Canceled]);
  });

  it("a canceled dependency sends its dependents to a person, who can drop it", () => {
    const pid = project();
    const { parent, first, second, claimToken } = splitting(pid);
    submitPlan(parent.id, { message: "## Split", claimToken });
    approvePlan(parent.id);

    cancelTask(first.id);
    const blocked = getTaskById(second.id)!;
    expect(blocked.status).toBe(TaskStatus.NeedsHuman);
    expect(blocked.blocker).toMatchObject({ phase: "code", fromStatus: TaskStatus.ReadyForCode, raisedBy: "system" });
    expect(blocked.blocker!.reason).toContain(first.id);
    expect(inboxReason(blocked)).not.toBeNull();
    expect(getTaskById(parent.id)!.status).toBe(TaskStatus.Split);

    const resumed = resolveBlocker(second.id, { answer: "go without it", targetStatus: TaskStatus.ReadyForCode });
    expect(resumed.blockedBy).toEqual([]);
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId: pid })!;
    expect(c.task.id).toBe(second.id);

    // The canceled subtask does not keep the parent from completing.
    forceStatus(second.id, TaskStatus.PrOpen);
    completeTask(second.id);
    expect(getTaskById(parent.id)!.status).toBe(TaskStatus.Complete);
  });

  it("a deleted dependency sends its dependents to a person too", () => {
    const pid = project();
    const { parent, first, second, claimToken } = splitting(pid);
    submitPlan(parent.id, { message: "## Split", claimToken });
    approvePlan(parent.id);
    softDeleteTask(first.id);
    dependencyDeleted(getTaskById(first.id)!);
    expect(getTaskById(second.id)!.status).toBe(TaskStatus.NeedsHuman);
    expect(resolveBlocker(second.id, { answer: "", targetStatus: TaskStatus.ReadyForCode }).blockedBy).toEqual([]);
  });

  it("a split task whose subtasks were all canceled goes to a person", () => {
    const pid = project();
    const { parent, first, second, claimToken } = splitting(pid);
    submitPlan(parent.id, { message: "## Split", claimToken });
    approvePlan(parent.id);
    cancelTask(second.id);
    cancelTask(first.id);
    const blocked = getTaskById(parent.id)!;
    expect(blocked.status).toBe(TaskStatus.NeedsHuman);
    expect(blocked.blocker).toMatchObject({ phase: "plan", fromStatus: TaskStatus.Split });
    expect(resolveBlocker(parent.id, { answer: "", targetStatus: TaskStatus.PlanChangesRequested }).status).toBe(
      TaskStatus.PlanChangesRequested,
    );
  });
});

describe("subtask dependencies", () => {
  it("must be earlier subtasks or other live tasks, never the task being split or a canceled one", () => {
    const pid = project();
    const { parent, first, claimToken } = splitting(pid);
    expect(() => createSubtask(parent.id, { title: "x", description: DESCRIPTION, claimToken, blockedBy: [parent.id] })).toThrow(
      "would never start",
    );
    const gone = createTaskForProject({ title: "gone", description: DESCRIPTION, projectId: pid });
    cancelTask(gone.id);
    expect(() => createSubtask(parent.id, { title: "x", description: DESCRIPTION, claimToken, blockedBy: [gone.id] })).toThrow("canceled");
    expect(createSubtask(parent.id, { title: "x", description: DESCRIPTION, claimToken, blockedBy: [first.id] }).blockedBy).toEqual([first.id]);
  });
});

describe("requiresPlan", () => {
  it("the refiner's choice is stored, so a later edit does not bring the DoR warning back", () => {
    const pid = project();
    const draft = createTaskForProject({ title: "rough", description: "export", projectId: pid, draft: true });
    const c = claimNextTask({ roles: ["refine"], agent: planner, projectId: pid })!;
    const out = submitRefinement(draft.id, {
      message: "ready",
      claimToken: c.claimToken,
      description: DESCRIPTION,
      acceptanceCriteria: ["header row $ bun test export"],
      risk: "high",
      requiresPlan: true,
    });
    expect(out.task).toMatchObject({ status: TaskStatus.PlanRequested, requiresPlan: true, dorIssues: [] });
    expect(editTask(draft.id, { title: "export as CSV" }).dorIssues).toEqual([]);
  });

  it("a person turns it on or off before work starts, which moves the task", () => {
    const pid = project();
    const task = createTaskForProject({ title: "t", description: DESCRIPTION, projectId: pid, risk: "high" });
    expect(task.dorIssues.join(" ")).toContain("require a plan");
    const planned = editTask(task.id, { requiresPlan: true });
    expect(planned).toMatchObject({ status: TaskStatus.PlanRequested, requiresPlan: true });
    expect(planned.dorIssues.join(" ")).not.toContain("require a plan");
    expect(editTask(task.id, { requiresPlan: false }).status).toBe(TaskStatus.ReadyForCode);
    // Unchanged: no move, and any status may send it.
    expect(editTask(task.id, { requiresPlan: false }).status).toBe(TaskStatus.ReadyForCode);
    forceStatus(task.id, TaskStatus.WaitingCodeReview);
    expect(() => editTask(task.id, { requiresPlan: true })).toThrow("only before work starts");
    expect(editTask(task.id, { requiresPlan: false, title: "same" }).title).toBe("same");
  });
});

function forceVerifyFailures(taskId: string, n: number) {
  // Failed verifications of the old plan, as the verifier would have counted them.
  patchTask(taskId, { verifyFailures: n });
}
