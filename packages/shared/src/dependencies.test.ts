import { describe, it, expect } from "bun:test";
import { createProject, getActivityEvents, getTaskById } from "./database.js";
import { TaskStatus } from "./index.js";
import { forceStatus } from "./testing.js";
import {
  addDependency,
  approvePlan,
  claimNextTask,
  createSubtask,
  createTaskForProject,
  editTask,
  removeDependency,
  submitPlan,
} from "./workflow.js";

process.env.MTQ_DB_PATH = ":memory:";

const agent = { toolName: "Deps", version: "1", model: "d", sessionId: "deps-agent" };
const DESCRIPTION = "Users can export their data as CSV from the settings page.";
let n = 0;

function project(extra: Record<string, unknown> = {}) {
  const id = `deps-${Date.now()}-${n++}`;
  createProject({ id, displayName: "Deps", workingDirectory: "/tmp/deps", ...extra } as any);
  return id;
}

function task(projectId: string, over: Record<string, unknown> = {}) {
  return createTaskForProject({ title: `task ${n++}`, description: DESCRIPTION, projectId, ...over });
}

describe("task dependencies", () => {
  it("a task is refined and planned before its dependencies complete, but nobody codes it until they do", () => {
    const pid = project();
    const dep = task(pid);
    forceStatus(dep.id, TaskStatus.WaitingCodeReview);
    const draft = task(pid, { draft: true, blockedBy: [dep.id] });
    const planned = task(pid, { requiresPlan: true, blockedBy: [dep.id] });
    const ready = task(pid, { blockedBy: [dep.id] });

    expect(claimNextTask({ roles: ["refine"], agent, projectId: pid })!.task.id).toBe(draft.id);
    const plan = claimNextTask({ roles: ["plan"], agent, projectId: pid })!;
    expect(plan.task.id).toBe(planned.id);
    expect(claimNextTask({ roles: ["code"], agent, projectId: pid })).toBeNull();

    forceStatus(dep.id, TaskStatus.Complete);
    expect(claimNextTask({ roles: ["code"], agent, projectId: pid })!.task.id).toBe(ready.id);
  });

  it("a subtask waits for its dependencies in every phase, planning included", () => {
    const pid = project({ autonomy: 1 });
    const parent = task(pid, { requiresPlan: true });
    const { claimToken } = claimNextTask({ roles: ["plan"], agent, projectId: pid })!;
    const first = createSubtask(parent.id, { title: "Backend", description: DESCRIPTION, claimToken });
    const second = createSubtask(parent.id, {
      title: "UI",
      description: DESCRIPTION,
      requiresPlan: true,
      blockedBy: [first.id],
      claimToken,
    });
    submitPlan(parent.id, { message: "## Split", claimToken, proposedSubtasks: ["Backend", "UI"] });
    approvePlan(parent.id);

    expect(getTaskById(second.id)!.status).toBe(TaskStatus.PlanRequested);
    expect(claimNextTask({ roles: ["plan"], agent, projectId: pid })).toBeNull();
    forceStatus(first.id, TaskStatus.Complete);
    expect(claimNextTask({ roles: ["plan"], agent, projectId: pid })!.task.id).toBe(second.id);
  });

  it("refuses itself, other projects, canceled and complete tasks, its parent and subtasks, and cycles", () => {
    const pid = project({ autonomy: 1 });
    const a = task(pid);
    const b = task(pid, { blockedBy: [a.id] });
    const elsewhere = task(project());
    const canceled = task(pid);
    forceStatus(canceled.id, TaskStatus.Canceled);
    const done = task(pid);
    forceStatus(done.id, TaskStatus.Complete);

    expect(() => editTask(a.id, { blockedBy: [a.id] })).toThrow("cannot start after itself");
    expect(() => task(pid, { blockedBy: [elsewhere.id] })).toThrow("unknown task");
    expect(() => task(pid, { blockedBy: ["no-such-task"] })).toThrow("unknown task");
    expect(() => task(pid, { blockedBy: [canceled.id] })).toThrow("canceled");
    expect(() => task(pid, { blockedBy: [done.id] })).toThrow("already complete");
    expect(() => editTask(a.id, { blockedBy: [b.id] })).toThrow("cycle");

    // Through a split: the parent waits for its subtask, which would wait for the parent's dependent.
    const parent = task(pid, { requiresPlan: true });
    const { claimToken } = claimNextTask({ roles: ["plan"], agent, projectId: pid })!;
    const child = createSubtask(parent.id, { title: "child", description: DESCRIPTION, claimToken });
    expect(() => editTask(child.id, { blockedBy: [parent.id] })).toThrow("parent");
    const waiter = task(pid, { blockedBy: [parent.id] });
    expect(() => editTask(child.id, { blockedBy: [waiter.id] })).toThrow("cycle");
    expect(() => addDependency(waiter.id, child.id, "agent")).not.toThrow();
  });

  it("a dependency that completed stays when the list is saved again; duplicates are dropped", () => {
    const pid = project();
    const a = task(pid);
    const b = task(pid);
    const t = task(pid, { blockedBy: [a.id, a.id] });
    expect(t.blockedBy).toEqual([a.id]);
    forceStatus(a.id, TaskStatus.Complete);
    expect(editTask(t.id, { blockedBy: [a.id, b.id] }).blockedBy).toEqual([a.id, b.id]);
  });

  it("agents add and remove dependencies, recorded as activity, never while the task is claimed", () => {
    const pid = project();
    const a = task(pid);
    const t = task(pid);
    expect(addDependency(t.id, a.id, "planner@1|p").blockedBy).toEqual([a.id]);
    expect(() => addDependency(t.id, a.id, "planner@1|p")).toThrow("already starts after");
    expect(getActivityEvents({ taskId: t.id }).find((e) => e.eventType === "dependencies_changed")).toMatchObject({
      actor: "planner@1|p",
      details: expect.stringContaining(`Added: ${a.title} (${a.id})`),
    });
    expect(removeDependency(t.id, a.id, "agent").blockedBy).toEqual([]);
    expect(() => removeDependency(t.id, a.id, "agent")).toThrow("does not start after");

    forceStatus(t.id, TaskStatus.Coding);
    expect(() => addDependency(t.id, a.id, "agent")).toThrow("An agent is working on this task");
  });
});
