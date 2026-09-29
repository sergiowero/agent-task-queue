import { describe, it, expect } from "bun:test";
import { createProject, getTaskById } from "./database.js";
import { TaskStatus, criteriaEditable } from "./catalog.js";
import { forceStatus } from "./testing.js";
import { approvePlan, claimNextTask, createTaskForProject, editTask, submitPlan } from "./workflow.js";

process.env.AGENTQ_DB_PATH = ":memory:";

const planner = { toolName: "Planner", version: "1", model: "p", sessionId: "lc-planner" };
let n = 0;

function project(extra: Record<string, unknown> = {}) {
  const id = `lifecycle-${Date.now()}-${n++}`;
  // L1: a person approves plans.
  createProject({ id, displayName: "Lifecycle", workingDirectory: "/tmp/lifecycle", autonomy: 1, ...extra } as any);
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
    validationPlan: { items: [{ criterionId: "AC1", how: "unit test", command: "bun test export" }], regressionCommands: [] },
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
    editTask(task.id, { acceptanceCriteria: ["exports a header row $ bun test export", "shows a download link"] });
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
