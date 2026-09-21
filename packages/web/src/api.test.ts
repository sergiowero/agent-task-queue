import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import type { Task, Project } from "@agentq/shared";
import { TaskStatus, createTask, beginTransaction, rollbackTransaction } from "@agentq/shared";
import { startServer } from "./index.js";

// Set test DB before the first DB call. The shared package resolves
// AGENTQ_DB_PATH lazily in getDb(), and nothing touches the DB at import time.
process.env.AGENTQ_DB_PATH = ":memory:";

type Server = ReturnType<typeof startServer>;

let server: Server;
let baseUrl: string;

const testProjectId = randomUUID();

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

function json(path: string, method: string, body?: unknown): Promise<Response> {
  return api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createTaskViaApi(overrides: Record<string, unknown> = {}): Promise<Task> {
  const res = await json("/api/tasks", "POST", {
    title: "Test task",
    description: "desc",
    projectId: testProjectId,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Task;
}

/** Simulates a CLI claim (the web API has no claim route). */
async function setStatus(taskId: string, status: TaskStatus): Promise<Task> {
  const res = await json(`/api/tasks/${taskId}`, "PUT", { status });
  expect(res.status).toBe(200);
  return (await res.json()) as Task;
}

async function subAction(taskId: string, action: string, body?: unknown): Promise<Response> {
  return json(`/api/tasks/${taskId}/${action}`, "POST", body);
}

async function expectTransition(
  taskId: string,
  action: string,
  expected: TaskStatus,
  body?: unknown,
): Promise<Task> {
  const res = await subAction(taskId, action, body);
  expect(res.status).toBe(200);
  const task = (await res.json()) as Task;
  expect(task.id).toBe(taskId);
  expect(task.status).toBe(expected);
  return task;
}

async function getTask(taskId: string): Promise<Task> {
  const res = await api(`/api/tasks/${taskId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Task;
}

function lastMessage(task: Task) {
  return task.conversation[task.conversation.length - 1];
}

beforeAll(async () => {
  // bun test runs every file in one process, so the in-memory DB singleton is
  // shared with other test files. Everything below runs inside one transaction
  // that is rolled back at the end (hard-deleting via the API is not possible
  // for tasks with activity rows, see the todo in the DELETE suite).
  beginTransaction();

  server = startServer({ port: 0, dev: false });
  baseUrl = `http://localhost:${server.port}`;

  const res = await json("/api/projects", "POST", {
    id: testProjectId,
    displayName: "API Test Project",
    workingDirectory: "/tmp/api-test-project",
  });
  expect(res.status).toBe(201);
});

afterAll(() => {
  server.stop(true);
  rollbackTransaction();
});

describe("startServer", () => {
  it("listens on a random port when port is 0", () => {
    expect(server.port).toBeGreaterThan(0);
  });

  it("returns 404 JSON for unknown API routes", async () => {
    const res = await api("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});

describe("GET /", () => {
  it("serves the SPA when dist exists, otherwise 404s gracefully", async () => {
    const res = await api("/");
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toContain("text/html");
    } else {
      expect(await res.json()).toEqual({ error: "not found" });
    }
  });
});

describe("/api/projects", () => {
  it("lists projects including the seeded one", async () => {
    const res = await api("/api/projects");
    expect(res.status).toBe(200);
    const projects = (await res.json()) as Project[];
    expect(projects.some((p) => p.id === testProjectId)).toBe(true);
  });

  it("rejects an invalid project body with 400", async () => {
    const res = await json("/api/projects", "POST", {
      id: "not-a-uuid",
      displayName: "",
      workingDirectory: "/tmp",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("creates, updates, soft-deletes and hard-deletes a project", async () => {
    const id = randomUUID();
    const createRes = await json("/api/projects", "POST", {
      id,
      displayName: "CRUD Project",
      workingDirectory: "/tmp/crud",
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Project;
    expect(created.id).toBe(id);
    expect(created.displayName).toBe("CRUD Project");
    expect(created.deletedAt).toBeNull();

    const updateRes = await json(`/api/projects/${id}`, "PUT", { displayName: "Renamed" });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as Project;
    expect(updated.displayName).toBe("Renamed");
    expect(updated.workingDirectory).toBe("/tmp/crud");

    const badUpdate = await json(`/api/projects/${id}`, "PUT", { displayName: "" });
    expect(badUpdate.status).toBe(400);

    const softRes = await api(`/api/projects/${id}`, { method: "DELETE" });
    expect(softRes.status).toBe(204);
    const listAfterSoft = (await (await api("/api/projects")).json()) as Project[];
    expect(listAfterSoft.some((p) => p.id === id)).toBe(false);

    // Soft-deleting twice is a no-op -> 404
    const softAgain = await api(`/api/projects/${id}`, { method: "DELETE" });
    expect(softAgain.status).toBe(404);

    const hardRes = await api(`/api/projects/${id}?hard=true`, { method: "DELETE" });
    expect(hardRes.status).toBe(204);

    const hardAgain = await api(`/api/projects/${id}?hard=true`, { method: "DELETE" });
    expect(hardAgain.status).toBe(404);
    const updateGone = await json(`/api/projects/${id}`, "PUT", { displayName: "x" });
    expect(updateGone.status).toBe(404);
  });
});

describe("POST /api/tasks", () => {
  it("returns 400 with a validation message on invalid body", async () => {
    const res = await json("/api/tasks", "POST", { title: "", projectId: "nope" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Title is required");
  });

  it("returns an error envelope on malformed JSON", async () => {
    const res = await api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    // parseBody throws, which wrapHandler surfaces as a 5xx error envelope.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid JSON");
  });

  it("creates a task with defaults (ready_for_code when no plan required)", async () => {
    const task = await createTaskViaApi({ title: "No plan" });
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.title).toBe("No plan");
    expect(task.status).toBe(TaskStatus.ReadyForCode);
    expect(task.requiresPlan).toBe(false);
    expect(task.projectId).toBe(testProjectId);
    expect(task.mergeBranch).toBe("develop");
    expect(task.assignedAgent).toBeNull();
  });

  it("creates a plan_requested task when requiresPlan is true", async () => {
    const task = await createTaskViaApi({
      title: "Needs plan",
      requiresPlan: true,
      guardrails: ["g1"],
      acceptanceCriteria: ["a", "b"],
      priority: 5,
    });
    expect(task.status).toBe(TaskStatus.PlanRequested);
    expect(task.requiresPlan).toBe(true);
    expect(task.guardrails).toEqual(["g1"]);
    expect(task.acceptanceCriteria).toEqual(["a", "b"]);
    expect(task.priority).toBe(5);
  });
});

describe("GET /api/tasks", () => {
  it("returns a paginated envelope and filters by projectId", async () => {
    const otherProject = randomUUID();
    const projRes = await json("/api/projects", "POST", {
      id: otherProject,
      displayName: "Other",
      workingDirectory: "/tmp/other",
    });
    expect(projRes.status).toBe(201);
    const t1 = await createTaskViaApi({ title: "Other 1", projectId: otherProject });
    const t2 = await createTaskViaApi({ title: "Other 2", projectId: otherProject });

    const res = await api(`/api/tasks?projectId=${otherProject}`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      data: Task[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
    expect(page.total).toBe(2);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.data.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
    expect(page.data.every((t) => t.projectId === otherProject)).toBe(true);
  });

  it("honours limit/offset and reports hasMore", async () => {
    const proj = randomUUID();
    await json("/api/projects", "POST", {
      id: proj,
      displayName: "Pg",
      workingDirectory: "/tmp/pg",
    });
    for (let i = 0; i < 3; i++) {
      await createTaskViaApi({ title: `Pg ${i}`, projectId: proj, priority: 10 - i });
    }

    const first = (await (await api(`/api/tasks?projectId=${proj}&limit=2&offset=0`)).json()) as {
      data: Task[];
      total: number;
      hasMore: boolean;
      limit: number;
    };
    expect(first.total).toBe(3);
    expect(first.limit).toBe(2);
    expect(first.data.length).toBe(2);
    expect(first.hasMore).toBe(true);
    // Ordered by priority DESC
    expect(first.data[0].title).toBe("Pg 0");

    const second = (await (await api(`/api/tasks?projectId=${proj}&limit=2&offset=2`)).json()) as {
      data: Task[];
      hasMore: boolean;
      offset: number;
    };
    expect(second.offset).toBe(2);
    expect(second.data.length).toBe(1);
    expect(second.hasMore).toBe(false);
  });

  it("falls back to default pagination on invalid params", async () => {
    const res = await api("/api/tasks?limit=abc&offset=-1");
    expect(res.status).toBe(200);
    const page = (await res.json()) as { limit: number; offset: number };
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
  });
});

describe("GET/PUT /api/tasks/:id", () => {
  it("returns 404 for an unknown task", async () => {
    const res = await api(`/api/tasks/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns the task by id", async () => {
    const created = await createTaskViaApi({ title: "Lookup" });
    const res = await api(`/api/tasks/${created.id}`);
    expect(res.status).toBe(200);
    const task = (await res.json()) as Task;
    expect(task.id).toBe(created.id);
    expect(task.title).toBe("Lookup");
  });

  it("updates fields via PUT and validates the body", async () => {
    const created = await createTaskViaApi({ title: "Before" });
    const res = await json(`/api/tasks/${created.id}`, "PUT", {
      title: "After",
      priority: 3,
      description: null,
      worktreePath: "/tmp/wt",
    });
    expect(res.status).toBe(200);
    const task = (await res.json()) as Task;
    expect(task.title).toBe("After");
    expect(task.priority).toBe(3);
    expect(task.description).toBeNull();
    expect(task.worktreePath).toBe("/tmp/wt");

    const bad = await json(`/api/tasks/${created.id}`, "PUT", { status: "not_a_status" });
    expect(bad.status).toBe(400);

    const missing = await json(`/api/tasks/${randomUUID()}`, "PUT", { title: "x" });
    expect(missing.status).toBe(404);
  });
});

describe("workflow sub-actions (requiresPlan task)", () => {
  let taskId: string;

  beforeAll(async () => {
    const task = await createTaskViaApi({ title: "Workflow", requiresPlan: true });
    taskId = task.id;
    expect(task.status).toBe(TaskStatus.PlanRequested);
  });

  it("returns 404 for a sub-action on an unknown task", async () => {
    const res = await subAction(randomUUID(), "approve-plan");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown sub-action name", async () => {
    const res = await subAction(taskId, "set-status", { targetStatus: TaskStatus.Coding });
    // set_status passes schema validation but has no handler branch
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown action" });
  });

  it("rejects an action whose name is not in the transition schema", async () => {
    const res = await subAction(taskId, "do-something-else");
    expect(res.status).toBe(400);
  });

  it("submit-plan requires Planning status", async () => {
    const res = await subAction(taskId, "submit-plan", { message: "too early" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Planning");
  });

  it("submit-plan -> waiting_plan_review (clears assignedAgent, records conversation)", async () => {
    await setStatus(taskId, TaskStatus.Planning);
    await json(`/api/tasks/${taskId}`, "PUT", {
      assignedAgent: { name: "planner", tool: "planner", model: "m" },
    });
    const task = await expectTransition(taskId, "submit-plan", TaskStatus.WaitingPlanReview, {
      message: "Plan v1",
      authorName: "planner-bot",
    });
    expect(task.assignedAgent).toBeNull();
    const last = task.conversation[task.conversation.length - 1];
    expect(last.message).toBe("Plan v1");
    expect(last.authorName).toBe("planner-bot");
    expect(last.messageType).toBe("plan");
    expect(task.history[task.history.length - 1]).toMatchObject({
      pre_status: TaskStatus.Planning,
      new_status: TaskStatus.WaitingPlanReview,
    });
  });

  it("request-plan-changes -> plan_changes_requested with the user's message", async () => {
    const task = await expectTransition(
      taskId,
      "request-plan-changes",
      TaskStatus.PlanChangesRequested,
      { message: "Please tighten scope" },
    );
    const last = task.conversation[task.conversation.length - 1];
    expect(last.message).toBe("Please tighten scope");
    expect(last.authorName).toBe("user");
  });

  it("approve-plan requires waiting_plan_review", async () => {
    const res = await subAction(taskId, "approve-plan");
    expect(res.status).toBe(400);
  });

  it("second submit-plan -> waiting_plan_review, approve-plan -> ready_for_code", async () => {
    await setStatus(taskId, TaskStatus.Planning);
    await expectTransition(taskId, "submit-plan", TaskStatus.WaitingPlanReview, {
      message: "Plan v2",
    });
    await expectTransition(taskId, "approve-plan", TaskStatus.ReadyForCode);
    // The approval note is persisted (the response body itself predates it).
    const persisted = await getTask(taskId);
    expect(persisted.status).toBe(TaskStatus.ReadyForCode);
    expect(lastMessage(persisted).message).toBe("Plan approved.");
  });

  it("submit-code requires Coding status", async () => {
    const res = await subAction(taskId, "submit-code", { message: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Coding");
  });

  it("submit-code -> waiting_code_review, request-ai-review -> code_review_requested", async () => {
    await setStatus(taskId, TaskStatus.Coding);
    const submitted = await expectTransition(taskId, "submit-code", TaskStatus.WaitingCodeReview, {
      message: "Implemented",
      authorName: "coder-bot",
    });
    expect(submitted.assignedAgent).toBeNull();
    const last = submitted.conversation[submitted.conversation.length - 1];
    expect(last.messageType).toBe("code");

    await expectTransition(taskId, "request-ai-review", TaskStatus.CodeReviewRequested);
  });

  it("submit-review requires Reviewing and returns to waiting_code_review", async () => {
    const early = await subAction(taskId, "submit-review", { message: "x" });
    expect(early.status).toBe(400);

    await setStatus(taskId, TaskStatus.Reviewing);
    const task = await expectTransition(taskId, "submit-review", TaskStatus.WaitingCodeReview, {
      message: "LGTM with nits",
    });
    const last = task.conversation[task.conversation.length - 1];
    expect(last.messageType).toBe("review");
  });

  it("request-code-changes -> changes_requested, then resubmit and approve-code -> approved", async () => {
    await expectTransition(taskId, "request-code-changes", TaskStatus.ChangesRequested, {
      message: "Fix the tests",
    });

    const tooEarly = await subAction(taskId, "approve-code");
    expect(tooEarly.status).toBe(400);

    await setStatus(taskId, TaskStatus.Coding);
    await expectTransition(taskId, "submit-code", TaskStatus.WaitingCodeReview, {
      message: "Fixed",
    });
    await expectTransition(taskId, "approve-code", TaskStatus.Approved);
    const persisted = await getTask(taskId);
    expect(lastMessage(persisted).message).toBe("Code approved.");
  });

  it("confirm-completion requires Merged", async () => {
    const res = await subAction(taskId, "confirm-completion");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Merged");
  });

  it("submit-merge validates required fields and -> merged; confirm-completion -> complete", async () => {
    await setStatus(taskId, TaskStatus.Merging);
    const missing = await subAction(taskId, "submit-merge", { branch: "feat/x" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain("branch, commit, and authors are required");

    const merged = await expectTransition(taskId, "submit-merge", TaskStatus.Merged, {
      branch: "feat/x",
      commit: "abc123",
      authors: "dev1,dev2",
      worktree: "/tmp/wt",
    });
    const last = merged.conversation[merged.conversation.length - 1];
    expect(last.messageType).toBe("merge");
    expect(last.message).toContain("Branch: feat/x");
    expect(last.message).toContain("Commit: abc123");
    expect(last.message).toContain("Authors: dev1,dev2");
    expect(last.message).toContain("Worktree: /tmp/wt");

    await expectTransition(taskId, "confirm-completion", TaskStatus.Complete);
  });

  it("cancel is rejected once the task is complete", async () => {
    const res = await subAction(taskId, "cancel");
    expect(res.status).toBe(400);
  });
});

describe("cancel / unblock / comment", () => {
  it("cancel -> canceled and blocks further submissions", async () => {
    const task = await createTaskViaApi({ title: "Cancel me", requiresPlan: true });
    await setStatus(task.id, TaskStatus.Planning);
    const canceled = await expectTransition(task.id, "cancel", TaskStatus.Canceled);
    expect(canceled.assignedAgent).toBeNull();

    const res = await subAction(task.id, "submit-plan", { message: "late" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("canceled");

    const again = await subAction(task.id, "cancel");
    expect(again.status).toBe(400);
  });

  it("unblock reverts in-progress statuses to their re-claimable state", async () => {
    const task = await createTaskViaApi({ title: "Unblock me", requiresPlan: true });

    const notBlocked = await subAction(task.id, "unblock");
    expect(notBlocked.status).toBe(400);

    await setStatus(task.id, TaskStatus.Planning);
    await expectTransition(task.id, "unblock", TaskStatus.PlanChangesRequested);

    await setStatus(task.id, TaskStatus.Coding);
    await expectTransition(task.id, "unblock", TaskStatus.ChangesRequested);

    await setStatus(task.id, TaskStatus.Reviewing);
    const unblocked = await expectTransition(task.id, "unblock", TaskStatus.CodeReviewRequested);
    expect(unblocked.assignedAgent).toBeNull();
    const last = unblocked.conversation[unblocked.conversation.length - 1];
    expect(last.message).toContain("Task unblocked");
  });

  it("add-comment / comment append a conversation entry without changing status", async () => {
    const task = await createTaskViaApi({ title: "Comment me" });

    const noMessage = await subAction(task.id, "add-comment", {});
    expect(noMessage.status).toBe(400);
    expect((await noMessage.json()).error).toContain("message is required");

    const commented = await expectTransition(task.id, "add-comment", TaskStatus.ReadyForCode, {
      message: "Hello there",
      authorName: "reviewer",
    });
    expect(commented.conversation.length).toBe(1);
    expect(commented.conversation[0]).toMatchObject({
      message: "Hello there",
      authorName: "reviewer",
      messageType: "user",
    });

    const viaAlias = await expectTransition(task.id, "comment", TaskStatus.ReadyForCode, {
      message: "Second",
    });
    expect(viaAlias.conversation.length).toBe(2);
    expect(viaAlias.conversation[1].authorName).toBe("user");
  });
});

describe("DELETE /api/tasks/:id", () => {
  it("returns 404 for an unknown task", async () => {
    const res = await api(`/api/tasks/${randomUUID()}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("soft-deletes by default (hidden from list, still fetchable by id)", async () => {
    const task = await createTaskViaApi({ title: "Soft delete" });
    const res = await api(`/api/tasks/${task.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);

    const list = (await (await api(`/api/tasks?projectId=${testProjectId}`)).json()) as {
      data: Task[];
    };
    expect(list.data.some((t) => t.id === task.id)).toBe(false);

    const byId = await api(`/api/tasks/${task.id}`);
    expect(byId.status).toBe(200);
    expect(((await byId.json()) as Task).deletedAt).not.toBeNull();

    // Already soft-deleted -> 404
    const again = await api(`/api/tasks/${task.id}`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  it("hard-deletes with ?hard=true", async () => {
    // Created directly (no activity rows) so the row can actually be removed; see the todo below.
    const task = createTask({ title: "Hard delete", description: "", projectId: testProjectId });
    const res = await api(`/api/tasks/${task.id}?hard=true`, { method: "DELETE" });
    expect(res.status).toBe(204);

    const byId = await api(`/api/tasks/${task.id}`);
    expect(byId.status).toBe(404);

    const again = await api(`/api/tasks/${task.id}?hard=true`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  it("hard-deletes an API-created task together with its activity rows", async () => {
    const task = await createTaskViaApi({ title: "Hard delete (with activity)" });
    const res = await api(`/api/tasks/${task.id}?hard=true`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const after = await api(`/api/tasks/${task.id}`);
    expect(after.status).toBe(404);
  });
});

describe("GET /api/events (SSE)", () => {
  it("streams a task_created event when a task is posted", async () => {
    const controller = new AbortController();
    // Bun's fetch() only resolves once the first body byte arrives on a streaming
    // response, so open the stream first and post tasks until it resolves.
    const pending = api("/api/events", { signal: controller.signal });
    pending.catch(() => {});

    const createdIds = new Set<string>();
    let res: Response | null = null;
    const deadline = Date.now() + 4_000;
    while (!res && Date.now() < deadline) {
      const task = await createTaskViaApi({ title: "SSE task" });
      createdIds.add(task.id);
      res = await Promise.race([
        pending,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
      ]);
    }
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toBe("text/event-stream");

    const reader = res!.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!buffer.includes("\n\n") && Date.now() < deadline + 2_000) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timed out waiting for SSE event")), 2_000),
          ),
        ]);
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      controller.abort();
      reader.cancel().catch(() => {});
    }

    const eventBlock = buffer.split("\n\n")[0];
    expect(eventBlock).toContain("event: task_created");
    const dataLine = eventBlock.split("\n").find((l) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.slice("data: ".length)) as Task;
    expect(createdIds.has(payload.id)).toBe(true);
    expect(payload.title).toBe("SSE task");
    expect(payload.status).toBe(TaskStatus.ReadyForCode);
  }, 10_000);
});
