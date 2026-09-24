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
  getActivityEvents,
  getProjectById,
  updateProject,
} from "./database.js";
import { getEvidence, getFindings } from "./records.js";
import { sweepQueue } from "./sweeper.js";
import { TaskStatus } from "./types.js";
import {
  approveCode,
  approvePlan,
  buildAgentRef,
  cancelTask,
  claimNextTask,
  completeTask,
  createTaskForProject,
  editTask,
  releaseTask,
  reportBlocker,
  requestAiReview,
  requestCodeChanges,
  requestPlanChanges,
  resolveBlocker,
  revertClaim,
  submitCode,
  submitMerge,
  submitPlan,
  submitReview,
  touchLease,
  transitionTask,
  unblockTask,
} from "./workflow.js";

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
    expect(a!.task.assignedAgent).toMatchObject({
      ...buildAgentRef(agentA.toolName, agentA.model),
      agentId: a!.agent.id,
      sessionKey: "session:session-a",
    });
    expect(b!.task.assignedAgent).toMatchObject(buildAgentRef(agentB.toolName, agentB.model));
    expect(a!.claimToken).toBeTruthy();
    expect(a!.task.claimToken).toBe(a!.claimToken);
    expect(b!.claimToken).not.toBe(a!.claimToken);

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

  it("the integrator claims approved into merging (the implementer no longer does)", () => {
    const approved = createTestTask({ title: "approved", status: TaskStatus.Approved });
    expect(claimNextTask({ role: "implementer", agent: agentA, projectId })).toBeNull();
    const result = claimNextTask({ role: "integrator", agent: agentA, projectId });
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
    expect(stored.assignedAgent).toMatchObject(buildAgentRef(agentA.toolName, agentA.model));
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0].actor).toBe(result!.agent.id);
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

describe("workflow actions", () => {
  const projectId = "actions-project-" + Date.now();
  const createdTaskIds: string[] = [];
  const planner = { toolName: "Planner", version: "1", model: "p", sessionId: "s-planner" };

  beforeAll(() => {
    createProject({ id: projectId, displayName: "Actions", workingDirectory: "/tmp/actions", autonomy: 0 });
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

  function newTask(requiresPlan = true) {
    const task = createTask({ title: "actions", description: "d", projectId, requiresPlan });
    createdTaskIds.push(task.id);
    return task;
  }

  function claimPlan() {
    const task = newTask();
    const claimed = claimNextTask({ role: "planner", agent: planner, projectId })!;
    expect(claimed.task.id).toBe(task.id);
    return claimed;
  }

  it("a submit needs the claim's token; the right token moves the task and clears it", () => {
    const { task, claimToken } = claimPlan();
    expect(() => submitPlan(task.id, { message: "p" })).toThrow("claimToken");
    expect(() => submitPlan(task.id, { message: "p", claimToken: "stale" })).toThrow("claimed by another agent session");
    expect(() => submitPlan(task.id, { message: "p", claimToken, agentId: "someone@1|else" })).toThrow("assigned to");
    const result = submitPlan(task.id, { message: "p", claimToken, context: "notes" });
    expect(result.newStatus).toBe(TaskStatus.WaitingPlanReview);
    expect(result.task.claimToken).toBeNull();
    expect(result.task.assignedAgent).toBeNull();
    expect(result.task.history.at(-1)!.actor).toBe("planner@1|p");
  });

  it("tasks forced into a status without a token (legacy claims) still accept submits", () => {
    const task = newTask();
    updateTask(task.id, { status: TaskStatus.Planning, assignedAgent: buildAgentRef("x", "y") });
    expect(submitPlan(task.id, { message: "p" }).newStatus).toBe(TaskStatus.WaitingPlanReview);
  });

  it("human actions check the status, write history with the actor, conversation and activity", () => {
    const { task, claimToken } = claimPlan();
    expect(() => approvePlan(task.id)).toThrow("Plan review");
    submitPlan(task.id, { message: "p", claimToken });
    const changes = requestPlanChanges(task.id, { message: "narrower scope" });
    expect(changes.status).toBe(TaskStatus.PlanChangesRequested);
    expect(changes.conversation.at(-1)).toMatchObject({ authorName: "user", message: "narrower scope", messageType: "user" });
    expect(changes.history.at(-1)).toMatchObject({ new_status: TaskStatus.PlanChangesRequested, actor: "user" });
    const events = getActivityEvents({ taskId: task.id }).map((e) => e.eventType);
    expect(events).toContain("plan_changes_requested");
  });

  it("the full human path: approve plan, request AI review, approve code, complete", () => {
    const { task, claimToken } = claimPlan();
    submitPlan(task.id, { message: "p", claimToken });
    expect(approvePlan(task.id).status).toBe(TaskStatus.ReadyForCode);
    const coder = claimNextTask({ role: "implementer", agent: planner, projectId })!;
    submitCode(task.id, { message: "c", worktree: "/w", claimToken: coder.claimToken });
    expect(requestAiReview(task.id).status).toBe(TaskStatus.CodeReviewRequested);
    // Another session reviews: nobody reviews their own code.
    expect(claimNextTask({ role: "reviewer", agent: planner, projectId })).toBeNull();
    const reviewer = claimNextTask({ role: "reviewer", agent: { ...planner, sessionId: "s-reviewer" }, projectId })!;
    submitReview(task.id, { verdict: "approve", message: "ok", claimToken: reviewer.claimToken });
    expect(requestCodeChanges(task.id, { message: "fix" }).status).toBe(TaskStatus.ChangesRequested);
    const again = claimNextTask({ role: "implementer", agent: planner, projectId })!;
    submitCode(task.id, { message: "c2", worktree: "/w", claimToken: again.claimToken });
    expect(approveCode(task.id).status).toBe(TaskStatus.Approved);
    const merger = claimNextTask({ role: "builder", agent: planner, projectId })!;
    submitMerge(task.id, { branch: "main", commit: "abc", authors: "a", claimToken: merger.claimToken });
    expect(completeTask(task.id).status).toBe(TaskStatus.Complete);
    expect(() => cancelTask(task.id)).toThrow("cannot be canceled");
  });

  it("an illegal edge is refused by the state machine", () => {
    const task = newTask();
    expect(() => transitionTask(getTaskById(task.id)!, TaskStatus.Complete, { actor: "user" })).toThrow(
      "cannot move from Plan requested to Complete",
    );
  });

  it("unblock frees every active status, merging included, and drops the claim", () => {
    const task = newTask(false);
    for (const [active, target] of [
      [TaskStatus.Planning, TaskStatus.PlanChangesRequested],
      [TaskStatus.Coding, TaskStatus.ChangesRequested],
      [TaskStatus.Reviewing, TaskStatus.CodeReviewRequested],
      [TaskStatus.Merging, TaskStatus.Approved],
    ] as const) {
      updateTask(task.id, { status: active, assignedAgent: buildAgentRef("a", "m"), claimToken: "t" });
      const unblocked = unblockTask(task.id);
      expect(unblocked.status).toBe(target);
      expect(unblocked.assignedAgent).toBeNull();
      expect(unblocked.claimToken).toBeNull();
    }
    expect(() => unblockTask(task.id)).toThrow("cannot be unblocked");
  });

  it("report_blocker parks the task in needs_human; resolve sends it to an allowed status", () => {
    const { task, claimToken } = claimPlan();
    const blocked = reportBlocker(task.id, {
      reason: "The description contradicts the guardrails",
      question: "Which one wins?",
      claimToken,
    });
    expect(blocked.newStatus).toBe(TaskStatus.NeedsHuman);
    expect(blocked.task.blocker).toMatchObject({ phase: "plan", fromStatus: TaskStatus.Planning, question: "Which one wins?" });
    expect(claimNextTask({ role: "senior", agent: planner, projectId })).toBeNull();

    expect(() => resolveBlocker(task.id, { answer: "x", targetStatus: TaskStatus.Approved })).toThrow("can be resolved to");
    const resolved = resolveBlocker(task.id, { answer: "The guardrails win.", targetStatus: TaskStatus.PlanChangesRequested });
    expect(resolved.status).toBe(TaskStatus.PlanChangesRequested);
    expect(resolved.blocker).toBeNull();
    expect(resolved.conversation.at(-1)!.message).toContain("The guardrails win.");
    expect(() => resolveBlocker(task.id, { answer: "", targetStatus: TaskStatus.PlanRequested })).toThrow("Needs human");
  });

  it("stops retrying after AGENTQ_MAX_REVERTS runs without a submit", () => {
    const task = newTask();
    for (let i = 1; i <= 2; i++) {
      claimNextTask({ role: "planner", agent: planner, projectId });
      expect(revertClaim(task.id, `crash ${i}`)!.status).toBe(TaskStatus.PlanRequested);
    }
    claimNextTask({ role: "planner", agent: planner, projectId });
    const blocked = revertClaim(task.id, "crash 3")!;
    expect(blocked.status).toBe(TaskStatus.NeedsHuman);
    expect(blocked.revertStreak).toBe(3);
    expect(blocked.blocker?.reason).toContain("3 times in a row");

    // A person's answer resets the streak.
    expect(resolveBlocker(task.id, { answer: "fixed the tool", targetStatus: TaskStatus.PlanRequested }).revertStreak).toBe(0);
  });

  it("a submit resets the revert streak", () => {
    newTask();
    let claimed = claimNextTask({ role: "planner", agent: planner, projectId })!;
    revertClaim(claimed.task.id, "crash");
    claimed = claimNextTask({ role: "planner", agent: planner, projectId })!;
    expect(getTaskById(claimed.task.id)!.revertStreak).toBe(1);
    expect(submitPlan(claimed.task.id, { message: "p", claimToken: claimed.claimToken }).task.revertStreak).toBe(0);
  });

  it("createTaskForProject uses the project's default branch and records task_created", () => {
    const task = createTaskForProject({ title: "defaults", description: "d", projectId }, "agent");
    createdTaskIds.push(task.id);
    expect(task.mergeBranch).toBe("main");
    expect(getProjectById(projectId)!.defaultMergeBranch).toBe("main");
    expect(getActivityEvents({ taskId: task.id }).map((e) => e.eventType).sort()).toEqual(["dor_warning", "task_created"]);
    expect(task.dorIssues).toContain("No acceptance criteria: say how anyone will know the task is done.");
    const explicit = createTaskForProject({ title: "explicit", description: "d", projectId, mergeBranch: "release" });
    createdTaskIds.push(explicit.id);
    expect(explicit.mergeBranch).toBe("release");
  });
});

describe("autonomy L2: reviews that decide", () => {
  const projectId = "l2-project-" + Date.now();
  const createdTaskIds: string[] = [];
  const coder = { toolName: "Coder", version: "1", model: "sonnet", sessionId: "s-coder" };
  const reviewer = { toolName: "Reviewer", version: "1", model: "opus", sessionId: "s-reviewer" };

  beforeAll(() => {
    createProject({ id: projectId, displayName: "L2", workingDirectory: "/tmp/l2" });
  });

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { deleteTask(id); } catch { softDeleteTask(id); }
    }
    createdTaskIds.length = 0;
    updateProject(projectId, { policy: { humanSampleEvery: 0, requireDifferentModel: false } });
  });

  afterAll(() => {
    try { deleteProject(projectId); } catch {}
  });

  /** A task coded by `coder` and waiting for an AI review. */
  function coded(risk: "low" | "medium" | "high" = "medium") {
    const task = createTask({ title: "l2", description: "d", projectId, risk });
    createdTaskIds.push(task.id);
    const c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    expect(c.task.id).toBe(task.id);
    const submitted = submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken });
    expect(submitted.newStatus).toBe(TaskStatus.CodeReviewRequested);
    return task.id;
  }

  function review(taskId: string, input: Omit<Parameters<typeof submitReview>[1], "claimToken">) {
    const r = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
    expect(r.task.id).toBe(taskId);
    return submitReview(taskId, { ...input, claimToken: r.claimToken });
  }

  function recode(taskId: string) {
    const c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    expect(c.task.id).toBe(taskId);
    const findingResolutions = getFindings(taskId)
      .filter((f) => f.status === "open")
      .map((f) => ({ id: f.id, status: "fixed" as const, resolution: "done" }));
    submitCode(taskId, { message: "fixed", worktree: "/w", claimToken: c.claimToken, findingResolutions });
  }

  it("submit_code asks for an AI review without a click, and the coder cannot take it", () => {
    const id = coded();
    expect(claimNextTask({ role: "senior", agent: coder, projectId })).toBeNull();
    expect(getTaskById(id)!.producers.code).toMatchObject({ sessionKey: "session:s-coder", model: "sonnet" });
  });

  it("approve moves the task to approved; the verdict is recorded", () => {
    const id = coded();
    const out = review(id, { verdict: "approve", message: "LGTM", findings: [{ severity: "nit", text: "rename x" }] });
    expect(out.newStatus).toBe(TaskStatus.Approved);
    const task = getTaskById(id)!;
    expect(task.codeRound).toBe(1);
    expect(task.lastReview).toMatchObject({ round: 1, verdict: "approve", by: "reviewer@1|opus" });
    expect(getFindings(id).map((f) => [f.id, f.severity, f.status])).toEqual([["R1-1", "nit", "open"]]);
  });

  it("refuses approve with open blocker/major findings, and request_changes without findings", () => {
    const id = coded();
    const r = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
    expect(() =>
      submitReview(id, { verdict: "approve", message: "x", claimToken: r.claimToken, findings: [{ severity: "major", text: "no tests" }] }),
    ).toThrow("open blocker or major findings: R1-1");
    expect(getFindings(id)).toEqual([]);
    expect(() => submitReview(id, { verdict: "request_changes", message: "x", claimToken: r.claimToken })).toThrow(
      "at least one open finding",
    );
    expect(() => submitReview(id, { verdict: "needs_human", message: "x", claimToken: r.claimToken })).toThrow("question");
    expect(getTaskById(id)!.status).toBe(TaskStatus.Reviewing);
  });

  it("request_changes loops back with findings by id; the next review verifies them", () => {
    const id = coded();
    expect(review(id, { verdict: "request_changes", message: "fix", findings: [{ severity: "major", text: "no tests", file: "a.ts", line: 3 }] }).newStatus).toBe(
      TaskStatus.ChangesRequested,
    );
    recode(id);
    const second = review(id, { verdict: "approve", message: "ok now", verifiedFindings: [{ id: "R1-1", status: "verified" }] });
    expect(second.newStatus).toBe(TaskStatus.Approved);
    expect(getFindings(id).map((f) => [f.id, f.status])).toEqual([["R1-1", "verified"]]);
  });

  it("after three change requests a person decides; answering gives a fresh set of rounds", () => {
    const id = coded();
    for (let round = 1; round <= 2; round++) {
      expect(review(id, { verdict: "request_changes", message: "again", findings: [{ severity: "minor", text: `r${round}` }] }).newStatus).toBe(
        TaskStatus.ChangesRequested,
      );
      recode(id);
    }
    const third = review(id, { verdict: "request_changes", message: "still", findings: [{ severity: "major", text: "r3" }] });
    expect(third.newStatus).toBe(TaskStatus.NeedsHuman);
    const blocked = getTaskById(id)!;
    expect(blocked.blocker?.reason).toContain("R3-1 (major)");
    expect(blocked.conversation.at(-1)!.messageType).toBe("system");
    expect(getActivityEvents({ taskId: id }).some((e) => e.eventType === "review_escalated")).toBe(true);

    resolveBlocker(id, { answer: "One more try.", targetStatus: TaskStatus.ChangesRequested });
    recode(id);
    expect(review(id, { verdict: "request_changes", message: "r4", findings: [{ severity: "minor", text: "r4" }] }).newStatus).toBe(
      TaskStatus.ChangesRequested,
    );
  });

  it("high-risk tasks and sampled approvals still reach a person", () => {
    expect(review(coded("high"), { verdict: "approve", message: "ok" }).newStatus).toBe(TaskStatus.WaitingCodeReview);
    updateProject(projectId, { policy: { humanSampleEvery: 1 } });
    const id = coded();
    expect(review(id, { verdict: "approve", message: "ok" }).newStatus).toBe(TaskStatus.WaitingCodeReview);
    expect(getTaskById(id)!.conversation.at(-1)!.message).toContain("spot check");
  });

  it("requireDifferentModel keeps the coder's model off the review", () => {
    updateProject(projectId, { policy: { requireDifferentModel: true } });
    const id = coded();
    const sameModel = { ...reviewer, model: "sonnet" };
    expect(claimNextTask({ role: "reviewer", agent: sameModel, projectId })).toBeNull();
    expect(claimNextTask({ role: "reviewer", agent: reviewer, projectId })!.task.id).toBe(id);
  });

  it("claims by hand-opened sessions get a lease; the sweeper returns expired ones to the queue", () => {
    const task = createTask({ title: "lease", description: "d", projectId });
    createdTaskIds.push(task.id);
    const c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    const lease = getTaskById(task.id)!.leaseExpiresAt!;
    expect(new Date(lease).getTime()).toBeGreaterThan(Date.now() + 80 * 60_000);
    expect(touchLease(task.id, "wrong")).toBe(false);
    expect(touchLease(task.id, c.claimToken)).toBe(true);

    expect(sweepQueue(new Date()).expired).not.toContain(task.id);
    const later = new Date(Date.now() + 3 * 60 * 60_000);
    // Other test files may leave claims behind; they expire too.
    expect(sweepQueue(later).expired).toContain(task.id);
    const released = getTaskById(task.id)!;
    expect(released.status).toBe(TaskStatus.ReadyForCode);
    expect(released.leaseExpiresAt).toBeNull();

    const byRunner = claimNextTask({ role: "implementer", agent: coder, projectId, runnerId: "r1" })!;
    expect(byRunner.task.leaseExpiresAt).toBeNull();
    expect(byRunner.task.assignedAgent?.sessionKey).toBe("runner:r1");
  });

  it("a review nobody eligible picks up goes to a person after reviewStarvationMin", () => {
    const id = coded();
    expect(sweepQueue(new Date()).starved).not.toContain(id);
    const later = new Date(Date.now() + 21 * 60_000);
    expect(sweepQueue(later).starved).toContain(id);
    const task = getTaskById(id)!;
    expect(task.status).toBe(TaskStatus.WaitingCodeReview);
    expect(task.history.at(-1)!.actor).toBe("system:sweeper");
  });
});

describe("evidence, validation plans and findings by id", () => {
  const projectId = "evidence-project-" + Date.now();
  const coder = { toolName: "Coder", version: "1", model: "sonnet", sessionId: "e-coder" };
  const reviewer = { toolName: "Reviewer", version: "1", model: "opus", sessionId: "e-reviewer" };

  beforeAll(() => {
    // L1: a person approves plans (L2 would send them to an AI critic first).
    createProject({ id: projectId, displayName: "Evidence", workingDirectory: "/tmp/evidence", autonomy: 1 });
  });

  afterAll(() => {
    try { deleteProject(projectId); } catch {}
  });

  /** A project of its own, so a claim can only return this test's task. */
  function fresh(autonomy: 0 | 1 | 2 | 3 = 2) {
    const id = `evidence-${Math.random().toString(36).slice(2)}`;
    createProject({ id, displayName: "Evidence", workingDirectory: "/tmp/evidence", autonomy });
    return id;
  }

  function planned() {
    const task = createTask({
      title: "validated",
      description: "d",
      projectId,
      requiresPlan: true,
      acceptanceCriteria: ["persists", "fast"],
    });
    const c = claimNextTask({ role: "planner", agent: coder, projectId })!;
    expect(c.task.id).toBe(task.id);
    return { task, claimToken: c.claimToken };
  }

  it("a validation plan must name the task's criteria; approval freezes it", () => {
    const { task, claimToken } = planned();
    expect(() =>
      submitPlan(task.id, {
        message: "## Plan",
        claimToken,
        validationPlan: { items: [{ criterionId: "AC9", how: "?" }], regressionCommands: [] },
      }),
    ).toThrow("unknown criteria: AC9");
    submitPlan(task.id, {
      message: "## Plan v1",
      claimToken,
      validationPlan: {
        items: [{ criterionId: "AC1", how: "reload test", command: "bun test persist" }],
        regressionCommands: ["bun test", " "],
      },
    });
    const approved = approvePlan(task.id);
    expect(approved.approvedPlan).toMatchObject({
      markdown: "## Plan v1",
      approvedBy: "user",
      validation: { items: [{ criterionId: "AC1", command: "bun test persist" }], regressionCommands: ["bun test"] },
    });
  });

  it("submit_code records evidence per criterion, the branch and the head commit", () => {
    const projectId = fresh();
    const task = createTask({ title: "evidence", description: "d", projectId, acceptanceCriteria: ["works"] });
    const c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    expect(c.task.id).toBe(task.id);
    expect(() =>
      submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken, criteria: [{ id: "AC7", status: "met" }] }),
    ).toThrow("Unknown criteria: AC7");
    submitCode(task.id, {
      message: "c",
      worktree: "/w",
      branch: "feat/works",
      headSha: "abc123",
      claimToken: c.claimToken,
      evidence: [{ kind: "command", criterionId: "AC1", command: "bun test", exitCode: 0, summary: "3 pass" }],
      criteria: [{ id: "AC1", status: "met" }],
    });
    const stored = getTaskById(task.id)!;
    expect(stored).toMatchObject({ realBranch: "feat/works", headSha: "abc123" });
    expect(stored.acceptanceCriteria[0]).toMatchObject({ status: "met", evidenceIds: ["E1"] });
    expect(getEvidence(task.id)[0]).toMatchObject({ id: "E1", producedBy: "coder@1|sonnet", summary: "3 pass" });
    // No commands on the project: verification is skipped and noted.
    expect(stored.verification).toMatchObject({ skipped: true });
  });

  it("the coder must answer every open finding; a finding reopened twice goes to a person", () => {
    const projectId = fresh();
    const task = createTask({ title: "dispute", description: "d", projectId });
    let c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken });
    let r = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
    submitReview(task.id, { verdict: "request_changes", message: "m", claimToken: r.claimToken, findings: [{ severity: "major", text: "add a test" }] });

    for (let round = 1; round <= 2; round++) {
      c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
      expect(() => submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken })).toThrow(
        "Answer every open review finding",
      );
      submitCode(task.id, {
        message: "c",
        worktree: "/w",
        claimToken: c.claimToken,
        findingResolutions: [{ id: "R1-1", status: "wontfix", resolution: "Covered by an existing test" }],
      });
      expect(getFindings(task.id)[0]).toMatchObject({ status: "wontfix", resolution: "Covered by an existing test" });
      r = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
      const out = submitReview(task.id, {
        verdict: "request_changes",
        message: "still needed",
        claimToken: r.claimToken,
        verifiedFindings: [{ id: "R1-1", status: "open" }],
      });
      expect(out.newStatus).toBe(round === 1 ? TaskStatus.ChangesRequested : TaskStatus.NeedsHuman);
    }
    expect(getTaskById(task.id)!.blocker?.reason).toContain("disagree on R1-1");
  });

  it("a person's edit of the criteria keeps the ids of unchanged ones", () => {
    const task = createTask({ title: "edit", description: "d", projectId, acceptanceCriteria: ["one", "two"] });
    const edited = editTask(task.id, { acceptanceCriteria: ["two", "three $ bun test three"] });
    expect(edited.acceptanceCriteria.map((c) => [c.id, c.text, c.verify.kind])).toEqual([
      ["AC2", "two", "review"],
      ["AC3", "three", "command"],
    ]);
  });
});
