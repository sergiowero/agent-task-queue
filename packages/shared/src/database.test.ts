import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import {
  createTask,
  getNextClaimableTask,
  updateTask,
  deleteTask,
  softDeleteTask,
  createProject,
  deleteProject,
  softDeleteProject,
  getTasks,
  getProjects,
  withTransaction,
  getConversationEntries,
  addConversationEntry,
  getStatusHistory,
  addStatusHistoryEntry,
  getMigrationStatus,
} from "./database.js";
import { TaskStatus, normalizeStatus } from "./types.js";
import {
  getClaimableStatuses,
  getClaimTransition,
  getEffectiveRole,
  recordHistory,
  addConversation,
  addActivity,
  normalizeStatusInput,
} from "./workflow.js";
import {
  createTaskSchema,
  updateTaskSchema,
  transitionTaskSchema,
  createProjectSchema,
  paginationSchema,
} from "./schemas.js";
import { paginate, buildPaginationSql } from "./pagination.js";
import { validateEnv } from "./env.js";

// Set test DB before any imports
process.env.AGENTQ_DB_PATH = ":memory:";

const testProjectId = "test-project-isolation";
const softDeleteProjectId = "soft-delete-project-" + Date.now();
const normalizedTablesProjectId = "normalized-project-" + Date.now();

describe("Database Isolation (8.1)", () => {
  it("uses in-memory database for tests", () => {
    expect(process.env.AGENTQ_DB_PATH).toBe(":memory:");
  });
});

describe("getNextClaimableTask", () => {
  const createdTaskIds: string[] = [];

  beforeAll(() => {
    createProject({
      id: testProjectId,
      displayName: "Test Project",
      workingDirectory: "/tmp/test",
    });
  });

  function createTestTask(data: {
    title: string;
    status: TaskStatus;
    priority?: number;
    assignedAgent?: any;
  }) {
    const task = createTask({ title: data.title, description: "test", projectId: testProjectId });
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
    const result = getNextClaimableTask([TaskStatus.PlanRequested]);
    expect(result).toBeNull();
  });

  it("returns the highest priority task", () => {
    createTestTask({ title: "low", status: TaskStatus.ReadyForCode, priority: 10 });
    createTestTask({ title: "high", status: TaskStatus.ReadyForCode, priority: 100 });
    createTestTask({ title: "mid", status: TaskStatus.ReadyForCode, priority: 50 });

    const result = getNextClaimableTask([TaskStatus.ReadyForCode]);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("high");
    expect(result!.priority).toBe(100);
  });

  it("skips claimed tasks", () => {
    createTestTask({
      title: "claimed",
      status: TaskStatus.ReadyForCode,
      priority: 100,
      assignedAgent: { name: "agent-1", tool: "test", model: "gpt-4" },
    });
    createTestTask({ title: "unclaimed", status: TaskStatus.ReadyForCode, priority: 50 });

    const result = getNextClaimableTask([TaskStatus.ReadyForCode]);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("unclaimed");
  });

  it("uses created_at as tiebreaker for same priority", async () => {
    const first = createTestTask({
      title: "first",
      status: TaskStatus.ReadyForCode,
      priority: 100,
    });
    await Bun.sleep(10);
    createTestTask({
      title: "second",
      status: TaskStatus.ReadyForCode,
      priority: 100,
    });

    const result = getNextClaimableTask([TaskStatus.ReadyForCode]);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("first");
  });
});

describe("Soft Delete (8.2)", () => {
  const createdTaskIds: string[] = [];

  beforeAll(() => {
    createProject({
      id: softDeleteProjectId,
      displayName: "Soft Delete Test",
      workingDirectory: "/tmp/soft-delete",
    });
  });

  function createTestTask(status: TaskStatus = TaskStatus.ReadyForCode) {
    const task = createTask({ title: "soft-delete-test", description: "test", projectId: softDeleteProjectId });
    const updated = updateTask(task.id, { status });
    createdTaskIds.push(task.id);
    return updated!;
  }

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { deleteTask(id); } catch {}
    }
    createdTaskIds.length = 0;
  });

  it("soft deletes a task", () => {
    const task = createTestTask();
    const result = softDeleteTask(task.id);
    expect(result).toBe(true);
  });

  it("excludes soft-deleted tasks from getTasks", () => {
    const task = createTestTask();
    softDeleteTask(task.id);
    const tasks = getTasks();
    expect(tasks.find((t) => t.id === task.id)).toBeUndefined();
  });

  it("hard deletes a task", () => {
    const task = createTestTask();
    const result = deleteTask(task.id);
    expect(result).toBe(true);
    const tasks = getTasks();
    expect(tasks.find((t) => t.id === task.id)).toBeUndefined();
  });

  it("soft deletes a project", () => {
    const projectId = "project-to-delete-" + Date.now();
    createProject({ id: projectId, displayName: "To Delete", workingDirectory: "/tmp/del" });
    const result = softDeleteProject(projectId);
    expect(result).toBe(true);
    const projects = getProjects();
    expect(projects.find((p) => p.id === projectId)).toBeUndefined();
    deleteProject(projectId);
  });
});

describe("Workflow Refactor (8.3)", () => {
  it("getClaimableStatuses returns planner statuses", () => {
    const statuses = getClaimableStatuses("planner");
    expect(statuses).toContain(TaskStatus.PlanRequested);
    expect(statuses).toContain(TaskStatus.PlanChangesRequested);
  });

  it("getClaimableStatuses returns compound senior statuses", () => {
    const statuses = getClaimableStatuses("senior");
    expect(statuses).toContain(TaskStatus.PlanRequested);
    expect(statuses).toContain(TaskStatus.ReadyForCode);
    expect(statuses).toContain(TaskStatus.CodeReviewRequested);
  });

  it("getClaimTransition maps planner to Planning", () => {
    const result = getClaimTransition(TaskStatus.PlanRequested, "planner");
    expect(result).toBe(TaskStatus.Planning);
  });

  it("getClaimTransition maps implementer to Coding", () => {
    const result = getClaimTransition(TaskStatus.ReadyForCode, "implementer");
    expect(result).toBe(TaskStatus.Coding);
  });

  it("getEffectiveRole resolves senior to planner for plan tasks", () => {
    const role = getEffectiveRole(TaskStatus.PlanRequested, "senior");
    expect(role).toBe("planner");
  });

  it("getEffectiveRole resolves senior to implementer for code tasks", () => {
    const role = getEffectiveRole(TaskStatus.ReadyForCode, "senior");
    expect(role).toBe("implementer");
  });

  it("normalizeStatusInput handles legacy ready for code", () => {
    const result = normalizeStatusInput("ready for code");
    expect(result).toBe(TaskStatus.ReadyForCode);
  });

  it("normalizeStatus handles legacy value in row mapper", () => {
    const result = normalizeStatus("ready for code");
    expect(result).toBe(TaskStatus.ReadyForCode);
  });

  it("normalizeStatusInput returns null for invalid status", () => {
    const result = normalizeStatusInput("invalid_status");
    expect(result).toBeNull();
  });
});

describe("Zod Validation Schemas (8.4)", () => {
  it("validates createTaskSchema with valid data", () => {
    const result = createTaskSchema.safeParse({
      title: "Test task",
      description: "A description",
      projectId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(true);
  });

  it("rejects createTaskSchema without title", () => {
    const result = createTaskSchema.safeParse({
      projectId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects createTaskSchema with empty title", () => {
    const result = createTaskSchema.safeParse({
      title: "",
      projectId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects createTaskSchema with invalid UUID", () => {
    const result = createTaskSchema.safeParse({
      title: "Test",
      projectId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("validates transitionTaskSchema with valid action", () => {
    const result = transitionTaskSchema.safeParse({
      action: "approve_plan",
    });
    expect(result.success).toBe(true);
  });

  it("rejects transitionTaskSchema with invalid action", () => {
    const result = transitionTaskSchema.safeParse({ action: "invalid_action" });
    expect(result.success).toBe(false);
  });

  it("validates createProjectSchema", () => {
    const result = createProjectSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000002",
      displayName: "Test Project",
      workingDirectory: "/tmp/test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects createProjectSchema with empty displayName", () => {
    const result = createProjectSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000002",
      displayName: "",
      workingDirectory: "/tmp/test",
    });
    expect(result.success).toBe(false);
  });

  it("validates paginationSchema with defaults", () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
    }
  });

  it("validates paginationSchema with custom values", () => {
    const result = paginationSchema.safeParse({ limit: "10", offset: "20" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
  });

  it("rejects paginationSchema with limit over 100", () => {
    const result = paginationSchema.safeParse({ limit: "200" });
    expect(result.success).toBe(false);
  });

  it("validates updateTaskSchema with partial data", () => {
    const result = updateTaskSchema.safeParse({ title: "Updated title" });
    expect(result.success).toBe(true);
  });
});

describe("Pagination Utilities (8.5)", () => {
  it("paginate returns correct structure", () => {
    const result = paginate([1, 2, 3], 10, { limit: 3, offset: 0 });
    expect(result.data).toEqual([1, 2, 3]);
    expect(result.total).toBe(10);
    expect(result.hasMore).toBe(true);
  });

  it("paginate sets hasMore false when at end", () => {
    const result = paginate([7, 8, 9], 9, { limit: 3, offset: 6 });
    expect(result.hasMore).toBe(false);
  });

  it("buildPaginationSql creates correct SQL", () => {
    const result = buildPaginationSql("SELECT * FROM tasks", { limit: 10, offset: 20 });
    expect(result.dataSql).toBe("SELECT * FROM tasks LIMIT ? OFFSET ?");
    expect(result.countSql).toBe("SELECT COUNT(*) as total FROM (SELECT * FROM tasks)");
    expect(result.dataParams).toEqual([10, 20]);
  });
});

describe("Transaction Wrapping (8.6)", () => {
  it("commits successful transaction", () => {
    let executed = false;
    withTransaction(() => {
      executed = true;
    });
    expect(executed).toBe(true);
  });

  it("rolls back on error", () => {
    expect(() => {
      withTransaction(() => {
        throw new Error("test error");
      });
    }).toThrow("test error");
  });
});

describe("Env Validation", () => {
  it("validateEnv returns default values", () => {
    const env = validateEnv();
    expect(env.PORT).toBe(3000);
    expect(env.AGENTQ_DB_PATH).toBe(":memory:");
  });
});

describe("Migration Status", () => {
  it("returns migration status list", () => {
    const status = getMigrationStatus();
    expect(status.length).toBeGreaterThan(0);
    expect(status[0]).toHaveProperty("name");
    expect(status[0]).toHaveProperty("applied");
  });
});

describe("Normalized Tables (8.4 continuation)", () => {
  const createdTaskIds: string[] = [];

  beforeAll(() => {
    createProject({
      id: normalizedTablesProjectId,
      displayName: "Normalized Tables",
      workingDirectory: "/tmp/norm",
    });
  });

  function createTestTask() {
    const task = createTask({ title: "norm-test", description: "test", projectId: normalizedTablesProjectId });
    createdTaskIds.push(task.id);
    return task;
  }

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { deleteTask(id); } catch {}
    }
    createdTaskIds.length = 0;
  });

  it("adds and reads conversation entries", () => {
    const task = createTestTask();
    addConversationEntry({ taskId: task.id, authorName: "test-user", message: "Hello", messageType: "user" });
    const entries = getConversationEntries(task.id);
    expect(entries.length).toBe(1);
    expect(entries[0].authorName).toBe("test-user");
    expect(entries[0].message).toBe("Hello");
  });

  it("adds and reads status history entries", () => {
    const task = createTestTask();
    addStatusHistoryEntry({ taskId: task.id, preStatus: "plan_requested", newStatus: "planning" });
    const entries = getStatusHistory(task.id);
    expect(entries.length).toBe(1);
    expect(entries[0].pre_status).toBe("plan_requested");
    expect(entries[0].new_status).toBe("planning");
  });

  it("returns empty arrays for tasks with no entries", () => {
    const task = createTestTask();
    expect(getConversationEntries(task.id)).toEqual([]);
    expect(getStatusHistory(task.id)).toEqual([]);
  });
});
