import { describe, it, expect, beforeAll, afterEach, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import {
  createTask,
  getTaskById,
  updateTask,
  deleteTask,
  softDeleteTask,
  createProject,
  deleteProject,
  getAgentById,
} from "./database.js";
import { TaskStatus } from "./types.js";
import { claimNextTask, releaseTask, buildAgentRef } from "./workflow.js";

// Set test DB before any imports
process.env.AGENTQ_DB_PATH = ":memory:";

const SHARED_INDEX = join(import.meta.dir, "index.ts");

const agentA = { toolName: "AgentA", version: "1.0", model: "model-a", sessionId: "session-a" };
const agentB = { toolName: "AgentB", version: "1.0", model: "model-b", sessionId: "session-b" };

describe("claimNextTask", () => {
  const projectId = "claim-project-" + Date.now();
  const otherProjectId = "claim-other-project-" + Date.now();
  const createdTaskIds: string[] = [];

  beforeAll(() => {
    createProject({ id: projectId, displayName: "Claim Project", workingDirectory: "/tmp/claim" });
    createProject({ id: otherProjectId, displayName: "Other Project", workingDirectory: "/tmp/other" });
  });

  function createTestTask(data: {
    title: string;
    status: TaskStatus;
    priority?: number;
    assignedAgent?: any;
    projectId?: string;
  }) {
    const task = createTask({ title: data.title, description: "test", projectId: data.projectId ?? projectId });
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
      try { deleteTask(id); } catch { softDeleteTask(id); }
    }
    createdTaskIds.length = 0;
  });

  afterAll(() => {
    try { deleteProject(projectId); } catch {}
    try { deleteProject(otherProjectId); } catch {}
  });

  it("returns null when no tasks are claimable", () => {
    createTestTask({ title: "coding", status: TaskStatus.Coding });
    expect(claimNextTask({ role: "implementer", agent: agentA, projectId })).toBeNull();
  });

  it("throws on an invalid role", () => {
    expect(() => claimNextTask({ role: "janitor", agent: agentA, projectId })).toThrow("Invalid role");
  });

  it("claims the highest priority task first", () => {
    createTestTask({ title: "low", status: TaskStatus.ReadyForCode, priority: 10 });
    createTestTask({ title: "high", status: TaskStatus.ReadyForCode, priority: 100 });
    createTestTask({ title: "mid", status: TaskStatus.ReadyForCode, priority: 50 });

    const result = claimNextTask({ role: "implementer", agent: agentA, projectId });
    expect(result).not.toBeNull();
    expect(result!.task.title).toBe("high");
    expect(result!.task.status).toBe(TaskStatus.Coding);
    expect(result!.effectiveRole).toBe("implementer");
  });

  it("two sequential claims by two agents return two different tasks", () => {
    const first = createTestTask({ title: "first", status: TaskStatus.ReadyForCode, priority: 100 });
    const second = createTestTask({ title: "second", status: TaskStatus.ReadyForCode, priority: 50 });

    const a = claimNextTask({ role: "implementer", agent: agentA, projectId });
    const b = claimNextTask({ role: "implementer", agent: agentB, projectId });
    expect(a!.task.id).toBe(first.id);
    expect(b!.task.id).toBe(second.id);
    expect(a!.task.assignedAgent).toEqual(buildAgentRef(agentA.toolName, agentA.model));
    expect(b!.task.assignedAgent).toEqual(buildAgentRef(agentB.toolName, agentB.model));

    expect(claimNextTask({ role: "implementer", agent: agentA, projectId })).toBeNull();
  });

  it("never returns an already-assigned task", () => {
    createTestTask({
      title: "taken",
      status: TaskStatus.ReadyForCode,
      priority: 100,
      assignedAgent: buildAgentRef("Someone", "gpt"),
    });
    const free = createTestTask({ title: "free", status: TaskStatus.ReadyForCode, priority: 1 });

    const result = claimNextTask({ role: "implementer", agent: agentA, projectId });
    expect(result!.task.id).toBe(free.id);
  });

  it("planner cannot claim ready_for_code tasks", () => {
    createTestTask({ title: "code", status: TaskStatus.ReadyForCode, priority: 100 });
    expect(claimNextTask({ role: "planner", agent: agentA, projectId })).toBeNull();
  });

  it("planner claims plan_requested into planning", () => {
    const task = createTestTask({ title: "plan", status: TaskStatus.PlanRequested });
    const result = claimNextTask({ role: "planner", agent: agentA, projectId });
    expect(result!.task.id).toBe(task.id);
    expect(result!.task.status).toBe(TaskStatus.Planning);
    expect(result!.agent.role).toBe("planner");
  });

  it("reviewer claims code_review_requested into reviewing", () => {
    createTestTask({ title: "code", status: TaskStatus.ReadyForCode, priority: 100 });
    const review = createTestTask({ title: "review", status: TaskStatus.CodeReviewRequested });
    const result = claimNextTask({ role: "reviewer", agent: agentA, projectId });
    expect(result!.task.id).toBe(review.id);
    expect(result!.task.status).toBe(TaskStatus.Reviewing);
  });

  it("implementer claims approved into merging", () => {
    const approved = createTestTask({ title: "approved", status: TaskStatus.Approved });
    const result = claimNextTask({ role: "implementer", agent: agentA, projectId });
    expect(result!.task.id).toBe(approved.id);
    expect(result!.task.status).toBe(TaskStatus.Merging);
  });

  it("senior can claim everything with the effective role", () => {
    createTestTask({ title: "plan", status: TaskStatus.PlanRequested, priority: 30 });
    createTestTask({ title: "code", status: TaskStatus.ReadyForCode, priority: 20 });
    createTestTask({ title: "review", status: TaskStatus.CodeReviewRequested, priority: 10 });

    const first = claimNextTask({ role: "senior", agent: agentA, projectId });
    expect(first!.task.title).toBe("plan");
    expect(first!.task.status).toBe(TaskStatus.Planning);
    expect(first!.effectiveRole).toBe("planner");

    const second = claimNextTask({ role: "senior", agent: agentA, projectId });
    expect(second!.task.title).toBe("code");
    expect(second!.task.status).toBe(TaskStatus.Coding);
    expect(second!.effectiveRole).toBe("implementer");

    const third = claimNextTask({ role: "senior", agent: agentA, projectId });
    expect(third!.task.title).toBe("review");
    expect(third!.task.status).toBe(TaskStatus.Reviewing);
    expect(third!.effectiveRole).toBe("reviewer");

    expect(claimNextTask({ role: "senior", agent: agentA, projectId })).toBeNull();
  });

  it("filters by projectId", () => {
    createTestTask({ title: "other", status: TaskStatus.ReadyForCode, priority: 100, projectId: otherProjectId });
    const mine = createTestTask({ title: "mine", status: TaskStatus.ReadyForCode, priority: 1 });

    const result = claimNextTask({ role: "implementer", agent: agentA, projectId });
    expect(result!.task.id).toBe(mine.id);
    expect(result!.task.projectId).toBe(projectId);

    expect(claimNextTask({ role: "implementer", agent: agentA, projectId })).toBeNull();
  });

  it("records history, conversation, context and registers the agent", () => {
    const task = createTestTask({ title: "side-effects", status: TaskStatus.PlanChangesRequested });
    const result = claimNextTask({ role: "planner", agent: agentA, context: "extra context", projectId });

    const stored = getTaskById(task.id)!;
    expect(stored.status).toBe(TaskStatus.Planning);
    expect(stored.assignedAgent).toEqual(buildAgentRef(agentA.toolName, agentA.model));
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0].pre_status).toBe(TaskStatus.PlanChangesRequested);
    expect(stored.history[0].new_status).toBe(TaskStatus.Planning);
    expect(stored.conversation).toHaveLength(1);
    expect(stored.conversation[0].authorName).toBe(result!.agent.id);
    expect(stored.conversation[0].message).toBe("Claimed task. Transitioning to planning.");
    expect(stored.contexts).toEqual(["extra context"]);
    expect(result!.task).toEqual(stored);

    const agent = getAgentById(result!.agent.id)!;
    expect(agent.toolName).toBe(agentA.toolName);
    expect(agent.role).toBe("planner");
    expect(agent.sessionId).toBe(agentA.sessionId);
  });
});

describe("releaseTask", () => {
  const projectId = "release-project-" + Date.now();
  const createdTaskIds: string[] = [];

  beforeAll(() => {
    createProject({ id: projectId, displayName: "Release Project", workingDirectory: "/tmp/release" });
  });

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { deleteTask(id); } catch { softDeleteTask(id); }
    }
    createdTaskIds.length = 0;
  });

  afterAll(() => {
    try { deleteProject(projectId); } catch {}
  });

  it("clears the assigned agent and applies the patch", () => {
    const task = createTask({ title: "release", description: "test", projectId });
    createdTaskIds.push(task.id);
    updateTask(task.id, { assignedAgent: buildAgentRef("A", "m"), status: TaskStatus.Coding });

    const released = releaseTask(task.id, { worktreePath: "/tmp/wt", status: TaskStatus.WaitingCodeReview })!;
    expect(released.assignedAgent).toBeNull();
    expect(released.worktreePath).toBe("/tmp/wt");
    expect(released.status).toBe(TaskStatus.WaitingCodeReview);

    const stored = getTaskById(task.id)!;
    expect(stored.assignedAgent).toBeNull();
    expect(stored.worktreePath).toBe("/tmp/wt");
  });

  it("returns null for an unknown task", () => {
    expect(releaseTask("does-not-exist")).toBeNull();
  });
});

describe("concurrent claims from separate processes", () => {
  // Each agent (e.g. one MCP server per coding tool) is its own process on the same database file.
  const dbPaths: string[] = [];

  function tempDbPath(): string {
    const p = join(tmpdir(), `agentq-claim-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    dbPaths.push(p);
    return p;
  }

  afterAll(() => {
    for (const p of dbPaths) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try { unlinkSync(p + suffix); } catch {}
      }
    }
  });

  async function run(args: string[], dbPath: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", ...args], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...process.env, AGENTQ_DB_PATH: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  async function seed(dbPath: string, taskCount: number): Promise<string[]> {
    const script = `
      import { createProject, createTask } from ${JSON.stringify(SHARED_INDEX)};
      createProject({ id: "p1", displayName: "P1", workingDirectory: "/tmp/p1" });
      const ids = [];
      for (let i = 0; i < ${taskCount}; i++) {
        ids.push(createTask({ title: "task-" + i, description: "d", projectId: "p1", priority: ${taskCount} - i }).id);
      }
      console.log(JSON.stringify(ids));
    `;
    const result = await run(["-e", script], dbPath);
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout.trim());
  }

  /** Claims in a fresh process and prints `{ success, task?, agent?, reason? }` like the MCP claim_task tool. */
  function claim(dbPath: string, agentName: string, projectId?: string) {
    const script = `
      import { claimNextTask, getProjectByTaskId } from ${JSON.stringify(SHARED_INDEX)};
      const result = claimNextTask({
        role: "implementer",
        agent: { toolName: ${JSON.stringify(agentName)}, version: "1.0", model: "model", sessionId: ${JSON.stringify(`session-${agentName}`)} },
        projectId: ${JSON.stringify(projectId ?? null)} ?? undefined,
      });
      console.log(JSON.stringify(result
        ? { success: true, task: { ...result.task, project: getProjectByTaskId(result.task.id) }, agent: { id: result.agent.id, role: result.effectiveRole } }
        : { success: false, reason: "no_tasks_available" }));
    `;
    return run(["-e", script], dbPath);
  }

  it("two simultaneous claims get different tasks", async () => {
    const dbPath = tempDbPath();
    const ids = await seed(dbPath, 2);

    const [a, b] = await Promise.all([claim(dbPath, "AgentA"), claim(dbPath, "AgentB")]);
    expect(a.stderr + b.stderr).toBe("");
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    const outA = JSON.parse(a.stdout);
    const outB = JSON.parse(b.stdout);
    expect(outA.success).toBe(true);
    expect(outB.success).toBe(true);
    expect(outA.task.id).not.toBe(outB.task.id);
    expect(new Set([outA.task.id, outB.task.id])).toEqual(new Set(ids));
    expect(outA.task.status).toBe(TaskStatus.Coding);
    expect(outB.task.status).toBe(TaskStatus.Coding);
    expect(outA.task.project.id).toBe("p1");
    expect(outA.agent.role).toBe("implementer");
  });

  it("only one of two simultaneous claims wins a single task", async () => {
    const dbPath = tempDbPath();
    const [id] = await seed(dbPath, 1);

    const [a, b] = await Promise.all([claim(dbPath, "AgentA"), claim(dbPath, "AgentB")]);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    const outputs = [JSON.parse(a.stdout), JSON.parse(b.stdout)];
    const winners = outputs.filter((o) => o.success === true);
    const losers = outputs.filter((o) => o.success === false);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0].task.id).toBe(id);
    expect(losers[0].reason).toBe("no_tasks_available");
  });

  it("respects the project filter", async () => {
    const dbPath = tempDbPath();
    const [id] = await seed(dbPath, 1);

    const claimFor = (project: string) => claim(dbPath, "AgentC", project);

    const miss = await claimFor("nope");
    expect(JSON.parse(miss.stdout).reason).toBe("no_tasks_available");

    const hit = await claimFor("p1");
    expect(JSON.parse(hit.stdout).task.id).toBe(id);
  });
});
