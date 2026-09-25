import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import {
  appendJson,
  getDbHandle,
  getProjectById,
  getTaskById,
  patchTask,
  updateProject,
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
  getMigrationStatus,
  getDbPath,
  getAgents,
  getRunners,
  resetDb,
  rollbackMigration,
} from "./database.js";
import { TaskStatus, normalizeStatus } from "./types.js";
import { claimRuleFor } from "./catalog.js";
import {
  getClaimableStatuses,
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
import { detectDefaultBranch } from "./git.js";

// Set test DB before any imports
process.env.AGENTQ_DB_PATH = ":memory:";

const testProjectId = "test-project-isolation";
const softDeleteProjectId = "soft-delete-project-" + Date.now();

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
  it("getClaimableStatuses returns the plan role's statuses", () => {
    const statuses = getClaimableStatuses(["plan"]);
    expect(statuses.sort()).toEqual([TaskStatus.PlanRequested, TaskStatus.PlanChangesRequested].sort());
  });

  it("getClaimableStatuses joins the statuses of several roles", () => {
    const statuses = getClaimableStatuses(["plan", "code", "review"]);
    expect(statuses).toContain(TaskStatus.PlanRequested);
    expect(statuses).toContain(TaskStatus.ReadyForCode);
    expect(statuses).toContain(TaskStatus.CodeReviewRequested);
    expect(statuses).not.toContain(TaskStatus.Approved);
  });

  it("claimRuleFor names the role and the active status of a claim", () => {
    expect(claimRuleFor(TaskStatus.PlanRequested)).toMatchObject({ role: "plan", to: TaskStatus.Planning });
    expect(claimRuleFor(TaskStatus.ChangesRequested)).toMatchObject({ role: "code", to: TaskStatus.Coding });
    expect(claimRuleFor(TaskStatus.Approved)).toMatchObject({ role: "pr", to: TaskStatus.Merging });
  });

  it("normalizeStatusInput handles legacy ready for code", () => {
    const result = normalizeStatusInput("ready for code");
    expect(result).toBe(TaskStatus.ReadyForCode);
  });

  it("normalizeStatus handles legacy value in row mapper", () => {
    const result = normalizeStatus("ready for code");
    expect(result).toBe(TaskStatus.ReadyForCode);
  });

  it("normalizeStatus reads the old merged status as pr_open (it only ever meant the PR was open)", () => {
    expect(normalizeStatus("merged")).toBe(TaskStatus.PrOpen);
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

  it("nests with savepoints: an inner failure rolls back only the inner work", () => {
    const projectId = "tx-nest-" + Date.now();
    withTransaction(() => {
      createProject({ id: projectId, displayName: "outer", workingDirectory: "/tmp/tx" });
      expect(() =>
        withTransaction(() => {
          updateProject(projectId, { displayName: "inner" });
          throw new Error("inner failure");
        }),
      ).toThrow("inner failure");
    });
    expect(getProjectById(projectId)!.displayName).toBe("outer");
    deleteProject(projectId);
  });
});

describe("patchTask / appendJson", () => {
  const projectId = "patch-project-" + Date.now();

  beforeAll(() => {
    createProject({ id: projectId, displayName: "Patch", workingDirectory: "/tmp/patch" });
  });

  it("patches only the given columns, so a concurrent append is kept", () => {
    const task = createTask({ title: "patch", description: "d", projectId });
    const stale = getTaskById(task.id)!;
    appendJson(task.id, "conversation", { authorName: "mcp", timestamp: "t", message: "from another process" });
    patchTask(stale.id, { title: "renamed" });
    const fresh = getTaskById(task.id)!;
    expect(fresh.title).toBe("renamed");
    expect(fresh.conversation.map((c) => c.message)).toEqual(["from another process"]);
    expect(fresh.updatedAt >= stale.updatedAt).toBe(true);
    deleteTask(task.id);
  });

  it("stores JSON columns and nulls", () => {
    const task = createTask({ title: "json", description: "d", projectId });
    const blocker = { reason: "r", question: "q", phase: "code" as const, fromStatus: TaskStatus.Coding, raisedBy: "a", at: "t" };
    expect(patchTask(task.id, { blocker, revertStreak: 2 })!.blocker).toEqual(blocker);
    const cleared = patchTask(task.id, { blocker: null, description: null })!;
    expect(cleared.blocker).toBeNull();
    expect(cleared.description).toBeNull();
    expect(cleared.revertStreak).toBe(2);
    expect(patchTask("missing", { title: "x" })).toBeNull();
    deleteTask(task.id);
  });
});

describe("default merge branch detection", () => {
  it("reads origin/HEAD, then a local main/master, else main", () => {
    const repo = mkdtempSync(join(tmpdir(), "agentq-branch-"));
    try {
      const git = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, ...args]);
      expect(detectDefaultBranch(repo)).toBe("main");
      git("init", "-q", "-b", "master");
      git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
      expect(detectDefaultBranch(repo)).toBe("master");
      git("update-ref", "refs/remotes/origin/develop", "HEAD");
      git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
      expect(detectDefaultBranch(repo)).toBe("develop");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
    expect(detectDefaultBranch(join(tmpdir(), "does-not-exist-" + Date.now()))).toBe("main");
  });
});

describe("Env Validation", () => {
  it("validateEnv returns default values", () => {
    const env = validateEnv();
    expect(env.PORT).toBe(3000);
    expect(env.AGENTQ_DB_PATH).toBe(":memory:");
  });

  it("defaults the database to ~/.agentq/agentq.db", () => {
    const previous = process.env.AGENTQ_DB_PATH;
    delete process.env.AGENTQ_DB_PATH;
    try {
      expect(getDbPath()).toBe(join(homedir(), ".agentq", "agentq.db"));
      expect(validateEnv().AGENTQ_DB_PATH).toBe("~/.agentq/agentq.db");
    } finally {
      process.env.AGENTQ_DB_PATH = previous;
    }
  });
});

describe("Migration Status", () => {
  it("returns migration status list", () => {
    const status = getMigrationStatus();
    expect(status.length).toBeGreaterThan(0);
    expect(status[0]).toHaveProperty("name");
    expect(status[0]).toHaveProperty("applied");
  });

  it("lists every migration in order, all applied", () => {
    const status = getMigrationStatus();
    const names = status.map((m) => m.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("010_project_default_merge_branch");
    expect(names).toContain("011_task_claim_and_blocker");
    expect(names).toContain("012_autonomy_and_policy");
    expect(names).toContain("013_task_findings");
    for (const n of [
      "014_project_profile",
      "015_structured_criteria",
      "016_validation_and_evidence",
      "017_app_state",
      "018_task_handoffs",
      "019_task_info",
      "020_drop_legacy_tables",
      "021_subtasks_plan_submission",
      "022_runner_roles_builder",
      "023_pull_requests",
      "024_phase_roles",
    ]) {
      expect(names).toContain(n);
    }
    expect(status.every((m) => m.applied)).toBe(true);
  });

  it("the legacy copies of conversation and history are gone", () => {
    const tables = getDbHandle()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r: any) => r.name);
    expect(tables).not.toContain("conversation_entries");
    expect(tables).not.toContain("status_history");
    expect(tables).toContain("task_handoffs");
  });
});

describe("SteerDetails & Guardrails", () => {
  const projectId = "steer-guard-test-" + Date.now();
  const createdTaskIds: string[] = [];

  beforeAll(() => {
    createProject({
      id: projectId,
      displayName: "SteerGuard Test",
      workingDirectory: "/tmp/steer-guard",
    });
  });

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { deleteTask(id); } catch {}
    }
    createdTaskIds.length = 0;
  });

  it("creates task with steerDetails and guardrails", () => {
    const task = createTask({
      title: "steer-guard-test",
      description: "test",
      projectId,
      steerDetails: "Use the shared types package. Prefer Zod validation.",
      guardrails: ["DO NOT use raw SQL", "DO NOT mutate input objects"],
    });
    createdTaskIds.push(task.id);
    expect(task.steerDetails).toBe("Use the shared types package. Prefer Zod validation.");
    expect(task.guardrails).toEqual(["DO NOT use raw SQL", "DO NOT mutate input objects"]);
  });

  it("defaults steerDetails to null when not provided", () => {
    const task = createTask({ title: "no-steer", description: "test", projectId });
    createdTaskIds.push(task.id);
    expect(task.steerDetails).toBeNull();
  });

  it("defaults guardrails to empty array when not provided", () => {
    const task = createTask({ title: "no-guard", description: "test", projectId });
    createdTaskIds.push(task.id);
    expect(task.guardrails).toEqual([]);
  });

  it("updates steerDetails and guardrails", () => {
    const task = createTask({ title: "update-test", description: "test", projectId });
    createdTaskIds.push(task.id);
    const updated = updateTask(task.id, {
      steerDetails: "Updated guidance",
      guardrails: ["New constraint"],
    });
    expect(updated!.steerDetails).toBe("Updated guidance");
    expect(updated!.guardrails).toEqual(["New constraint"]);
  });

  it("clears steerDetails by setting to null", () => {
    const task = createTask({
      title: "clear-steer",
      description: "test",
      projectId,
      steerDetails: "Some guidance",
    });
    createdTaskIds.push(task.id);
    const updated = updateTask(task.id, { steerDetails: null });
    expect(updated!.steerDetails).toBeNull();
  });

  it("persists steerDetails and guardrails through retrieval", () => {
    const task = createTask({
      title: "persist-test",
      description: "test",
      projectId,
      steerDetails: "Persist this",
      guardrails: ["Must persist"],
    });
    createdTaskIds.push(task.id);
    const tasks = getTasks();
    const found = tasks.find((t) => t.id === task.id);
    expect(found).toBeDefined();
    expect(found!.steerDetails).toBe("Persist this");
    expect(found!.guardrails).toEqual(["Must persist"]);
  });
});

describe("Schema Validation — SteerDetails & Guardrails", () => {
  it("validates createTaskSchema with steerDetails", () => {
    const result = createTaskSchema.safeParse({
      title: "Test",
      projectId: "00000000-0000-0000-0000-000000000001",
      steerDetails: "Some guidance",
    });
    expect(result.success).toBe(true);
  });

  it("validates createTaskSchema with guardrails", () => {
    const result = createTaskSchema.safeParse({
      title: "Test",
      projectId: "00000000-0000-0000-0000-000000000001",
      guardrails: ["One", "Two"],
    });
    expect(result.success).toBe(true);
  });

  it("validates createTaskSchema with both fields", () => {
    const result = createTaskSchema.safeParse({
      title: "Test",
      projectId: "00000000-0000-0000-0000-000000000001",
      steerDetails: "Guidance",
      guardrails: ["Const1", "Const2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects createTaskSchema with non-array guardrails", () => {
    const result = createTaskSchema.safeParse({
      title: "Test",
      projectId: "00000000-0000-0000-0000-000000000001",
      guardrails: "not-an-array",
    });
    expect(result.success).toBe(false);
  });

  it("validates updateTaskSchema with steerDetails null", () => {
    const result = updateTaskSchema.safeParse({
      steerDetails: null,
    });
    expect(result.success).toBe(true);
  });

  it("validates updateTaskSchema with guardrails", () => {
    const result = updateTaskSchema.safeParse({
      guardrails: ["Updated"],
    });
    expect(result.success).toBe(true);
  });
});

// Last in the file: it swaps the in-memory database for a file-backed one to re-run a migration.
describe("024_phase_roles", () => {
  it("turns legacy runner roles into role lists and renames agent roles", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentq-roles-"));
    const previous = process.env.AGENTQ_DB_PATH;
    try {
      resetDb();
      process.env.AGENTQ_DB_PATH = join(dir, "agentq.db");
      rollbackMigration("024_phase_roles");
      const d = getDbHandle();
      const now = new Date().toISOString();
      const insert = d.prepare(
        "INSERT INTO runners (id, name, tool, role, created_at, updated_at) VALUES (?, ?, 'claude', ?, ?, ?)",
      );
      for (const role of ["senior", "architect", "qa", "builder", "reviewer"]) insert.run(role, role, role, now, now);
      d.prepare(
        "INSERT INTO agents (id, tool_name, version, model, role, session_id) VALUES ('legacy', 't', '1', 'm', 'implementer', 's')",
      ).run();

      resetDb(); // reopening runs the pending migration
      expect(Object.fromEntries(getRunners().map((r) => [r.id, r.roles]))).toEqual({
        senior: ["refine", "plan", "plan_review", "code", "review", "pr"],
        architect: ["plan", "plan_review", "review"],
        qa: ["verify", "review"],
        builder: ["code", "pr"],
        reviewer: ["review"],
      });
      expect(getAgents().find((a) => a.id === "legacy")?.role).toBe("code");
    } finally {
      resetDb();
      process.env.AGENTQ_DB_PATH = previous;
      // Windows may keep the file locked a moment after close.
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
});
