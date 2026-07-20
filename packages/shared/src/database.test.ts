import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTask, getNextClaimableTask, updateTask, deleteTask } from "./database.js";
import { TaskStatus } from "./types.js";

describe("getNextClaimableTask", () => {
  const createdTaskIds: string[] = [];

  function createTestTask(data: {
    title: string;
    status: TaskStatus;
    priority?: number;
    assignedAgent?: any;
  }) {
    const task = createTask({ title: data.title });
    const updated = updateTask(task.id, {
      status: data.status,
      priority: data.priority ?? 0,
      assignedAgent: data.assignedAgent ?? null,
    });
    createdTaskIds.push(task.id);
    return updated!;
  }

  afterEach(() => {
    for (const id of createdTaskIds) {
      deleteTask(id);
    }
    createdTaskIds.length = 0;
  });

  it("returns null when no statuses provided", () => {
    const result = getNextClaimableTask([]);
    expect(result).toBeNull();
  });

  it("returns null when no tasks match statuses", () => {
    createTestTask({ title: "task1", status: TaskStatus.Coding });
    const result = getNextClaimableTask([TaskStatus.New]);
    expect(result).toBeNull();
  });

  it("returns the highest priority task", () => {
    createTestTask({ title: "low", status: TaskStatus.Ready, priority: 10 });
    createTestTask({ title: "high", status: TaskStatus.Ready, priority: 100 });
    createTestTask({ title: "mid", status: TaskStatus.Ready, priority: 50 });

    const result = getNextClaimableTask([TaskStatus.Ready]);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("high");
    expect(result!.priority).toBe(100);
  });

  it("skips claimed tasks", () => {
    createTestTask({
      title: "claimed",
      status: TaskStatus.Ready,
      priority: 100,
      assignedAgent: { name: "agent-1", tool: "test", model: "gpt-4" },
    });
    createTestTask({ title: "unclaimed", status: TaskStatus.Ready, priority: 50 });

    const result = getNextClaimableTask([TaskStatus.Ready]);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("unclaimed");
  });

  it("uses created_at as tiebreaker for same priority", async () => {
    const first = createTestTask({ title: "first", status: TaskStatus.Ready, priority: 100 });
    // Small delay to ensure different created_at
    await Bun.sleep(10);
    const second = createTestTask({ title: "second", status: TaskStatus.Ready, priority: 100 });

    const result = getNextClaimableTask([TaskStatus.Ready]);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("first");
  });

  it("filters by multiple statuses", () => {
    createTestTask({ title: "new-task", status: TaskStatus.New, priority: 10 });
    createTestTask({ title: "changes-requested", status: TaskStatus.ChangesRequested, priority: 100 });

    const result = getNextClaimableTask([TaskStatus.New, TaskStatus.ChangesRequested]);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("changes-requested");
  });

  it("returns null when all matching tasks are claimed", () => {
    createTestTask({
      title: "claimed1",
      status: TaskStatus.Ready,
      assignedAgent: { name: "agent-1", tool: "test", model: "gpt-4" },
    });
    createTestTask({
      title: "claimed2",
      status: TaskStatus.Ready,
      assignedAgent: { name: "agent-2", tool: "test", model: "gpt-4" },
    });

    const result = getNextClaimableTask([TaskStatus.Ready]);
    expect(result).toBeNull();
  });
});
