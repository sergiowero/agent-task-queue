import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import type { Task } from "@agentq/shared";
import {
  TaskStatus,
  createProject,
  createTask,
  deleteProject,
  deleteRunner,
  deleteTask,
  getRunners,
  updateTask,
} from "@agentq/shared";
import { startServer } from "./index.js";
import { clearModelCache, setModelExecForTests } from "./runner/models.js";

// Set test DB before the first DB call (resolved lazily in getDb()).
process.env.AGENTQ_DB_PATH = ":memory:";

type Server = ReturnType<typeof startServer>;

let server: Server;
let baseUrl: string;

const projectId = randomUUID();
const createdRunnerIds: string[] = [];
const createdTaskIds: string[] = [];

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

async function createRunnerViaApi(overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await json("/api/runners", "POST", {
    name: "API runner",
    tool: "custom",
    role: "planner",
    projectId,
    pollIntervalSec: 1,
    extraArgs: ["bash", "-c", "true"],
    ...overrides,
  });
  expect(res.status).toBe(201);
  const runner = await res.json();
  createdRunnerIds.push(runner.id);
  return runner;
}

/** Collects `event` frames from /api/events until `done` is satisfied or the timeout hits. */
async function collectSSE(
  event: string,
  trigger: () => void,
  done: (found: any[]) => boolean,
  timeoutMs = 8000,
): Promise<any[]> {
  const controller = new AbortController();
  const res = await api("/api/events", { signal: controller.signal });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const found: any[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  // Give the server a tick to register the client before triggering the change.
  await Bun.sleep(50);
  trigger();

  try {
    while (!done(found) && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(deadline - Date.now()).then(() => ({ done: true, value: undefined }) as const),
      ]);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (ev === event && data) found.push(JSON.parse(data));
      }
    }
  } finally {
    controller.abort();
  }
  return found;
}

beforeAll(async () => {
  // No outer transaction here: runner start/stop uses transactions itself.
  // Everything created below is hard-deleted in afterAll.
  server = startServer({ port: 0, dev: false });
  baseUrl = `http://localhost:${server.port}`;
  createProject({ id: projectId, displayName: "Runners API Project", workingDirectory: "/tmp" });
});

afterAll(async () => {
  setModelExecForTests(null);
  clearModelCache();
  for (const id of createdRunnerIds) {
    await json(`/api/runners/${id}`, "DELETE").catch(() => {});
    deleteRunner(id);
  }
  for (const id of createdTaskIds) deleteTask(id);
  deleteProject(projectId);
  server.stop(true);
});

describe("GET /api/runners/tools", () => {
  it("lists every supported tool with install status", async () => {
    const res = await api("/api/runners/tools");
    expect(res.status).toBe(200);
    const tools = (await res.json()) as { tool: string; installed: boolean; version: string | null }[];
    expect(tools.map((t) => t.tool).sort()).toEqual(["claude", "codex", "custom", "gemini", "opencode"]);
    const custom = tools.find((t) => t.tool === "custom")!;
    expect(custom.installed).toBe(true);
    expect(custom.version).toBeNull();
    for (const t of tools) {
      expect(typeof t.installed).toBe("boolean");
      if (!t.installed) expect(t.version).toBeNull();
    }
  });
});

describe("GET /api/runners/tools/:tool/models", () => {
  const calls: string[][] = [];
  beforeAll(() => {
    clearModelCache();
    // Never spawn the real CLIs from the test suite.
    setModelExecForTests(async (cmd) => {
      calls.push(cmd);
      if (cmd.join(" ") === "opencode models") {
        return { stdout: "opencode/big-pickle\ngithub-copilot/claude-opus-5\n", exitCode: 0 };
      }
      return { stdout: "", exitCode: 127 };
    });
  });

  it("returns the discovered models, caches them and refreshes on demand", async () => {
    let res = await api("/api/runners/tools/opencode/models");
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body).toMatchObject({ tool: "opencode", source: "cli", efforts: ["minimal", "low", "medium", "high", "max"], defaultEffort: null });
    expect(body.models).toEqual([
      { id: "opencode/big-pickle", label: "big-pickle", description: "opencode" },
      { id: "github-copilot/claude-opus-5", label: "claude-opus-5", description: "github-copilot" },
    ]);
    expect(calls).toEqual([["opencode", "models"]]);

    res = await api("/api/runners/tools/opencode/models");
    body = await res.json();
    expect(body.source).toBe("cache");
    expect(calls).toHaveLength(1);

    res = await api("/api/runners/tools/opencode/models?refresh=1");
    body = await res.json();
    expect(body.source).toBe("cli");
    expect(calls).toHaveLength(2);
  });

  it("degrades to static data when the CLI is unavailable", async () => {
    const res = await api("/api/runners/tools/codex/models");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tool).toBe("codex");
    expect(body.source).toBe("static");
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);

    const custom = await (await api("/api/runners/tools/custom/models")).json();
    expect(custom).toEqual({ tool: "custom", source: "static", models: [], efforts: null, defaultEffort: null });
  });

  it("rejects unknown tools and does not treat the path as a runner id", async () => {
    expect((await api("/api/runners/tools/vim/models")).status).toBe(400);
    expect((await api("/api/runners/tools/opencode/nope")).status).toBe(404);
    expect((await json("/api/runners/tools/opencode/models", "POST")).status).toBe(404);
  });
});

describe("runners CRUD", () => {
  it("creates a runner with defaults and live state", async () => {
    const runner = await createRunnerViaApi({ name: "defaults" });
    expect(runner).toMatchObject({
      name: "defaults",
      tool: "custom",
      role: "planner",
      projectId,
      model: null,
      effort: null,
      concurrency: 1,
      pollIntervalSec: 1,
      permissionMode: "safe",
      extraArgs: ["bash", "-c", "true"],
      enabled: false,
    });
    expect(runner.state).toMatchObject({ id: runner.id, running: false, activeJobs: 0, lastError: null, lastJob: null });
  });

  it("validates the body", async () => {
    let res = await json("/api/runners", "POST", { name: "", tool: "custom", role: "planner" });
    expect(res.status).toBe(400);
    res = await json("/api/runners", "POST", { name: "x", tool: "vim", role: "planner" });
    expect(res.status).toBe(400);
    res = await json("/api/runners", "POST", { name: "x", tool: "claude", role: "boss" });
    expect(res.status).toBe(400);
    res = await json("/api/runners", "POST", { name: "x", tool: "claude", role: "senior", concurrency: 0 });
    expect(res.status).toBe(400);
    res = await json("/api/runners", "POST", { name: "x", tool: "claude", role: "senior", projectId: "missing" });
    expect(res.status).toBe(404);
    res = await json("/api/runners", "POST", { name: "x", tool: "claude", role: "senior", effort: "x".repeat(41) });
    expect(res.status).toBe(400);
  });

  it("persists the effort on create and update", async () => {
    const runner = await createRunnerViaApi({ name: "effort", tool: "claude", model: "sonnet", effort: "high", extraArgs: null });
    expect(runner).toMatchObject({ tool: "claude", model: "sonnet", effort: "high" });

    let res = await api(`/api/runners/${runner.id}`);
    expect((await res.json()).effort).toBe("high");

    res = await json(`/api/runners/${runner.id}`, "PUT", { effort: "max" });
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ model: "sonnet", effort: "max" });

    // Omitting the field keeps it; null clears it.
    res = await json(`/api/runners/${runner.id}`, "PUT", { name: "effort-2" });
    expect((await res.json()).effort).toBe("max");
    res = await json(`/api/runners/${runner.id}`, "PUT", { effort: null });
    expect((await res.json()).effort).toBeNull();
  });

  it("lists, reads, updates and deletes", async () => {
    const runner = await createRunnerViaApi({ name: "crud" });

    let res = await api("/api/runners");
    expect(res.status).toBe(200);
    const list = (await res.json()) as any[];
    expect(list.some((r) => r.id === runner.id && r.state)).toBe(true);

    res = await api(`/api/runners/${runner.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("crud");

    res = await json(`/api/runners/${runner.id}`, "PUT", {
      name: "renamed",
      model: "opus",
      concurrency: 3,
      permissionMode: "full",
      projectId: null,
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated).toMatchObject({ name: "renamed", model: "opus", concurrency: 3, permissionMode: "full", projectId: null });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(runner.updatedAt).getTime());

    res = await json(`/api/runners/${runner.id}`, "PUT", { tool: "nope" });
    expect(res.status).toBe(400);

    res = await json(`/api/runners/${runner.id}`, "DELETE");
    expect(res.status).toBe(204);
    res = await api(`/api/runners/${runner.id}`);
    expect(res.status).toBe(404);
    expect(getRunners().some((r) => r.id === runner.id)).toBe(false);
  });

  it("404s for unknown runners and sub-routes", async () => {
    const missing = randomUUID();
    expect((await api(`/api/runners/${missing}`)).status).toBe(404);
    expect((await json(`/api/runners/${missing}/start`, "POST")).status).toBe(404);
    const runner = await createRunnerViaApi({ name: "subroutes" });
    expect((await api(`/api/runners/${runner.id}/nope`)).status).toBe(404);
    expect((await api(`/api/runners/${runner.id}/jobs/${randomUUID()}/log`)).status).toBe(404);
  });
});

describe("start / stop", () => {
  it("starts and stops a runner, persisting enabled", async () => {
    const runner = await createRunnerViaApi({ name: "start-stop" });

    let res = await json(`/api/runners/${runner.id}/start`, "POST");
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.state.running).toBe(true);

    res = await api(`/api/runners/${runner.id}/jobs`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);

    res = await json(`/api/runners/${runner.id}/stop`, "POST");
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.state.running).toBe(false);
  });

  it("PUT enabled toggles the engine and DELETE stops a running runner", async () => {
    const runner = await createRunnerViaApi({ name: "toggle" });
    let res = await json(`/api/runners/${runner.id}`, "PUT", { enabled: true });
    expect((await res.json()).state.running).toBe(true);
    res = await json(`/api/runners/${runner.id}`, "PUT", { enabled: false });
    expect((await res.json()).state.running).toBe(false);

    res = await json(`/api/runners/${runner.id}/start`, "POST");
    expect((await res.json()).state.running).toBe(true);
    res = await json(`/api/runners/${runner.id}`, "DELETE");
    expect(res.status).toBe(204);
    res = await api("/api/runners");
    expect(((await res.json()) as any[]).some((r) => r.id === runner.id)).toBe(false);
  });

  it("creating with enabled: true starts immediately and broadcasts runner_updated", async () => {
    const events = await collectSSE(
      "runner_updated",
      () => void createRunnerViaApi({ name: "auto", enabled: true }),
      (found) => found.length >= 1,
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].running).toBe(true);
    const id = events[0].id;
    const res = await json(`/api/runners/${id}/stop`, "POST");
    expect(res.status).toBe(200);
  });
});

describe("SSE task watcher", () => {
  it("broadcasts task_updated for changes written directly to the database", async () => {
    const task = createTask({ title: "watched", description: "", projectId, requiresPlan: true });
    createdTaskIds.push(task.id);

    const events = await collectSSE(
      "task_updated",
      () => {
        // Simulates the CLI: a write that bypasses the web server entirely.
        updateTask(task.id, { status: TaskStatus.Planning, assignedAgent: { name: "cli", tool: "cli", model: "m" } });
      },
      (found) => found.some((e: Task) => e.id === task.id && e.status === TaskStatus.Planning),
    );

    expect(events.length).toBeGreaterThanOrEqual(1);
    const mine = events.find((e: Task) => e.id === task.id && e.status === TaskStatus.Planning) as Task | undefined;
    expect(mine).toBeDefined();
    expect(mine!.status).toBe(TaskStatus.Planning);
    expect(mine!.assignedAgent?.tool).toBe("cli");
  });
});

describe("user actions include their note", () => {
  it("approve-plan / approve-code / request-ai-review / confirm-completion return the conversation entry", async () => {
    const task = createTask({ title: "notes", description: "", projectId, requiresPlan: true });
    createdTaskIds.push(task.id);

    updateTask(task.id, { status: TaskStatus.WaitingPlanReview });
    let res = await json(`/api/tasks/${task.id}/approve-plan`, "POST");
    expect(res.status).toBe(200);
    let body = (await res.json()) as Task;
    expect(body.status).toBe(TaskStatus.ReadyForCode);
    expect(body.conversation.at(-1)?.message).toBe("Plan approved.");

    updateTask(task.id, { status: TaskStatus.WaitingCodeReview });
    res = await json(`/api/tasks/${task.id}/request-ai-review`, "POST");
    body = (await res.json()) as Task;
    expect(body.conversation.at(-1)?.message).toBe("AI code review requested.");

    updateTask(task.id, { status: TaskStatus.WaitingCodeReview });
    res = await json(`/api/tasks/${task.id}/approve-code`, "POST");
    body = (await res.json()) as Task;
    expect(body.conversation.at(-1)?.message).toBe("Code approved.");

    updateTask(task.id, { status: TaskStatus.Merged });
    res = await json(`/api/tasks/${task.id}/confirm-completion`, "POST");
    body = (await res.json()) as Task;
    expect(body.status).toBe(TaskStatus.Complete);
    expect(body.conversation.at(-1)?.message).toBe("Task completed.");
  });
});
