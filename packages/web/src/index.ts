import type {
  Task,
  PaginatedResponse,
} from "@agentq/shared";
import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,
  softDeleteTask,
  getAgents,
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  softDeleteProject,
  addActivityEvent,
  getActivityEvents,
  TaskStatus,
  recordHistory,
  addConversation,
  addActivity,
  CANCELED_CANT_CANCEL,
  CANT_DELETE_STATUSES,
  createTaskSchema,
  updateTaskSchema,
  createProjectSchema,
  updateProjectSchema,
  transitionTaskSchema,
  paginationSchema,
  paginate,
  validateEnv,
} from "@agentq/shared";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { resolve, extname } from "path";

const env = validateEnv();
const PORT = env.PORT;
const isDev = process.argv.includes("--dev");

let viteProcess: ChildProcess | null = null;
let viteCrashTimer: Timer | null = null;

async function startVite(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, "../../..");
  viteProcess = spawn("bun", ["run", "dev"], {
    cwd: resolve(repoRoot, "packages/web-ui"),
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  viteProcess.stdout?.on("data", (data) => process.stdout.write(`[vite] ${data}`));
  viteProcess.stderr?.on("data", (data) => process.stderr.write(`[vite] ${data}`));

  viteProcess.on("exit", (code) => {
    console.log(`[vite] exited with code ${code}`);
    viteProcess = null;
    if (isDev && code !== 0) {
      if (viteCrashTimer) clearTimeout(viteCrashTimer);
      viteCrashTimer = setTimeout(() => {
        console.log("[vite] restarting...");
        startVite();
      }, 2000);
    }
  });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://localhost:5173");
      if (res.ok) {
        console.log("[vite] dev server ready");
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn("[vite] did not become ready within 60s, continuing anyway");
}

function stopVite() {
  if (viteCrashTimer) clearTimeout(viteCrashTimer);
  if (viteProcess) {
    viteProcess.kill();
    viteProcess = null;
  }
}

async function proxyToVite(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `http://localhost:5173${url.pathname}${url.search}`;
  return fetch(target, {
    method: req.method,
    headers: req.headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
  });
}

const DIST_DIR = resolve(import.meta.dir, "../../web-ui/dist");
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

async function serveIndexHtml(): Promise<Response | null> {
  try {
    const indexFile = Bun.file(DIST_DIR + "/index.html");
    const stat = await indexFile.stat();
    if (stat && stat.size) {
      return new Response(indexFile, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
        },
      });
    }
  } catch {}
  return null;
}

async function serveStatic(url: URL): Promise<Response | null> {
  const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const file = Bun.file(DIST_DIR + filePath);
    const stat = await file.stat();
    if (!stat || !stat.size) {
      if (!filePath.startsWith("/api")) return serveIndexHtml();
      return null;
    }
    const ext = extname(filePath);
    const cacheControl = filePath.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    return new Response(file, {
      headers: {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
      },
    });
  } catch {
    if (!filePath.startsWith("/api")) return serveIndexHtml();
    return null;
  }
}

const sseClients = new Set<ReadableStreamDefaultController>();
let sseKeepAlive: Timer | null = null;

function broadcastSSE(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const controller of sseClients) {
    try {
      controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(controller);
    }
  }
}

function ensureKeepAlive() {
  if (sseKeepAlive) return;
  sseKeepAlive = setInterval(() => {
    if (sseClients.size === 0) return;
    const payload = new TextEncoder().encode(": keepalive\n\n");
    for (const controller of sseClients) {
      try {
        controller.enqueue(payload);
      } catch {
        sseClients.delete(controller);
      }
    }
  }, 30_000);
}

function stopKeepAlive() {
  if (sseKeepAlive) {
    clearInterval(sseKeepAlive);
    sseKeepAlive = null;
  }
}

function corsHeaders(): HeadersInit {
  if (isDev) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {};
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function parseBody(req: Request): Promise<any> {
  const text = await req.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON in request body");
  }
}

function getTaskIdFromUrl(url: string): string | null {
  const match = url.match(/\/api\/tasks\/([a-z0-9-]+)/);
  return match ? match[1] : null;
}

function getSubAction(pathname: string): string | null {
  const match = pathname.match(/\/api\/tasks\/[a-z0-9-]+\/(.+)/);
  return match ? match[1] : null;
}

function getProjectIdFromUrl(pathname: string): string | null {
  const match = pathname.match(/\/api\/projects\/([a-z0-9-]+)/);
  return match ? match[1] : null;
}

function logRequest(method: string, pathname: string, status: number, durationMs: number) {
  console.log(`[${new Date().toISOString()}] ${method} ${pathname} ${status} ${durationMs}ms`);
}

function wrapHandler(
  handler: (req: Request, url: URL) => Promise<Response | null>,
): (req: Request, url: URL) => Promise<Response | null> {
  return async (req, url) => {
    const start = Date.now();
    try {
      const res = await handler(req, url);
      if (res == null) return null;
      logRequest(req.method, url.pathname, res.status, Date.now() - start);
      return res;
    } catch (e: any) {
      logRequest(req.method, url.pathname, e == null ? 404 : 500, Date.now() - start);
      if (e == null) return null;
      console.error(`[ERROR] ${req.method} ${url.pathname}:`, e);
      return errorResponse(e.message || "Internal server error", 500);
    }
  };
}

async function main() {
  if (isDev) {
    console.log("[server] starting in dev mode, launching Vite...");
    await startVite();
    process.on("SIGINT", () => {
      stopVite();
      stopKeepAlive();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      stopVite();
      stopKeepAlive();
      process.exit(0);
    });
  }

  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const handlers: Array<(req: Request, url: URL) => Promise<Response | null>> = [
        handleOptions,
        handleSSE,
        handleGetAgents,
        handleProjects,
        handleProjectById,
        handleActivity,
        handleTasksList,
        handleCreateTask,
        handleTaskSubActions,
        handleTaskById,
        handleUnmatchedApi,
        handleDevProxy,
        handleStatic,
      ];

      for (const handler of handlers) {
        const res = await handler(req, url);
        if (res) return res;
      }

      return errorResponse("not found", 404);
    },
  });

  console.log(`AgentQ Web Server running on http://localhost:${server.port}`);
}

// ─── Handler implementations ────────────────────────────────────────

async function handleOptions(req: Request, url: URL): Promise<Response | null> {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders() });
}

const handleSSE = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/events" || req.method !== "GET") throw null;
  const stream = new ReadableStream({
    start(controller) {
      sseClients.add(controller);
      ensureKeepAlive();
      req.signal?.addEventListener("abort", () => {
        sseClients.delete(controller);
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...corsHeaders(),
    },
  });
});

const handleGetAgents = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/agents" || req.method !== "GET") throw null;
  const pagination = paginationSchema.safeParse({
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  const { limit, offset } = pagination.success ? pagination.data : { limit: 50, offset: 0 };
  const role = url.searchParams.get("role") ?? undefined;
  const tool = url.searchParams.get("tool") ?? undefined;

  const allAgents = getAgents({ role, tool });
  const sliced = allAgents.slice(offset, offset + limit);
  return jsonResponse(paginate(sliced, allAgents.length, { limit, offset }));
});

const handleProjects = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/projects") throw null;
  if (req.method === "GET") {
    return jsonResponse(getProjects());
  }
  if (req.method === "POST") {
    const body = await parseBody(req);
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const project = createProject(parsed.data);
    return jsonResponse(project, 201);
  }
  return null;
});

const handleProjectById = wrapHandler(async (req, url) => {
  const id = getProjectIdFromUrl(url.pathname);
  if (!id) throw null;
  if (req.method === "PUT") {
    const body = await parseBody(req);
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const project = updateProject(id, parsed.data);
    if (!project) return errorResponse("not found", 404);
    return jsonResponse(project);
  }
  if (req.method === "DELETE") {
    const hard = url.searchParams.get("hard") === "true";
    if (hard) {
      const deleted = deleteProject(id);
      if (!deleted) return errorResponse("not found", 404);
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const ok = softDeleteProject(id);
    if (!ok) return errorResponse("not found", 404);
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  return null;
});

const handleActivity = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/activity" || req.method !== "GET") throw null;
  const pagination = paginationSchema.safeParse({
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  const { limit, offset } = pagination.success ? pagination.data : { limit: 50, offset: 0 };
  const taskId = url.searchParams.get("taskId") ?? undefined;
  const agentId = url.searchParams.get("agentId") ?? undefined;
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  const allEvents = getActivityEvents({ taskId, agentId, from, to, limit: offset + limit });
  const sliced = allEvents.slice(0, limit);
  return jsonResponse(paginate(sliced, allEvents.length, { limit, offset }));
});

const handleTasksList = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/tasks" || req.method !== "GET") throw null;
  const pagination = paginationSchema.safeParse({
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  const { limit, offset } = pagination.success ? pagination.data : { limit: 50, offset: 0 };
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const allTasks = getTasks(projectId);
  const sliced = allTasks.slice(offset, offset + limit);
  return jsonResponse(paginate(sliced, allTasks.length, { limit, offset }));
});

const handleCreateTask = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/tasks" || req.method !== "POST") throw null;
  const body = await parseBody(req);
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const task = createTask(parsed.data);
  addActivity(task.id, "task_created", "user");
  broadcastSSE("task_created", task);
  return jsonResponse(task, 201);
});

const handleTaskSubActions = wrapHandler(async (req, url) => {
  const taskId = getTaskIdFromUrl(url.pathname);
  if (!taskId || req.method !== "POST") throw null;
  const subAction = getSubAction(url.pathname);
  if (!subAction) throw null;

  const task = getTaskById(taskId);
  if (!task) return errorResponse("not found", 404);

  const body = await parseBody(req);
  const actionMap: Record<string, string> = {
    "confirm-completion": "complete",
  };
  const action = actionMap[subAction] ?? subAction.replace(/-/g, "_");
  const parsed = transitionTaskSchema.safeParse({ ...body, action });
  if (!parsed.success) {
    return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
  }

  let updated: Task | null = null;

  switch (action) {
    case "submit_plan": {
      if (task.status === TaskStatus.Canceled) {
        return errorResponse("Task is canceled and cannot accept submissions.");
      }
      if (task.status !== TaskStatus.Planning) {
        return errorResponse("task must be in Planning status");
      }
      updated = recordHistory(task, TaskStatus.WaitingPlanReview);
      if (body?.message) {
        updated = addConversation(updated!, body.authorName ?? "agent", body.message, "plan");
      }
      updated = updateTask(updated!.id, { assignedAgent: null });
      addActivity(taskId, "plan_submitted", body?.authorName ?? "agent");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "submit_code": {
      if (task.status === TaskStatus.Canceled) {
        return errorResponse("Task is canceled and cannot accept submissions.");
      }
      if (task.status !== TaskStatus.Coding) {
        return errorResponse("task must be in Coding status");
      }
      updated = recordHistory(task, TaskStatus.WaitingCodeReview);
      if (body?.message) {
        updated = addConversation(updated!, body.authorName ?? "agent", body.message, "code");
      }
      updated = updateTask(updated!.id, { assignedAgent: null });
      addActivity(taskId, "code_submitted", body?.authorName ?? "agent");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "submit_review": {
      if (task.status === TaskStatus.Canceled) {
        return errorResponse("Task is canceled and cannot accept submissions.");
      }
      if (task.status !== TaskStatus.Reviewing) {
        return errorResponse("task must be in Reviewing status");
      }
      updated = recordHistory(task, TaskStatus.WaitingCodeReview);
      if (body?.message) {
        updated = addConversation(
          updated!,
          body.authorName ?? "agent",
          body.message,
          "review",
        );
      }
      updated = updateTask(updated!.id, { assignedAgent: null });
      addActivity(taskId, "review_submitted", body?.authorName ?? "agent");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "submit_merge": {
      if (task.status === TaskStatus.Canceled) {
        return errorResponse("Task is canceled and cannot accept submissions.");
      }
      if (task.status !== TaskStatus.Merging) {
        return errorResponse("task must be in Merging status");
      }
      if (!body?.branch || !body?.commit || !body?.authors) {
        return errorResponse("branch, commit, and authors are required");
      }
      const mergeDetails = [
        `Branch: ${body.branch}`,
        `Commit: ${body.commit}`,
        `Authors: ${body.authors}`,
        body.worktree ? `Worktree: ${body.worktree}` : null,
        body.message ? `Message: ${body.message}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      updated = recordHistory(task, TaskStatus.Merged);
      updated = addConversation(
        updated!,
        body.authorName ?? "agent",
        `Merge submitted. ${mergeDetails}`,
        "merge",
      );
      updated = updateTask(updated!.id, { assignedAgent: null });
      addActivity(taskId, "merge_submitted", body.authorName ?? "agent");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "approve_plan": {
      if (task.status !== TaskStatus.WaitingPlanReview) {
        return errorResponse("task must be in Waiting Plan Review status");
      }
      updated = recordHistory(task, TaskStatus.ReadyForCode);
      addConversation(updated!, "user", "Plan approved.", "user");
      addActivity(taskId, "plan_approved", "user");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "request_plan_changes": {
      if (task.status !== TaskStatus.WaitingPlanReview) {
        return errorResponse("task must be in Waiting Plan Review status");
      }
      updated = recordHistory(task, TaskStatus.PlanChangesRequested);
      if (body?.message) {
        updated = addConversation(updated!, "user", body.message, "user");
      } else {
        updated = addConversation(updated!, "user", "Plan changes requested.", "user");
      }
      addActivity(taskId, "plan_changes_requested", "user", body?.message);
      broadcastSSE("task_updated", updated);
      break;
    }

    case "approve_code": {
      if (task.status !== TaskStatus.WaitingCodeReview) {
        return errorResponse("task must be in Waiting Code Review status");
      }
      updated = recordHistory(task, TaskStatus.Approved);
      addConversation(updated!, "user", "Code approved.", "user");
      addActivity(taskId, "code_approved", "user");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "request_code_changes": {
      if (task.status !== TaskStatus.WaitingCodeReview) {
        return errorResponse("task must be in Waiting Code Review status");
      }
      updated = recordHistory(task, TaskStatus.ChangesRequested);
      if (body?.message) {
        updated = addConversation(updated!, "user", body.message, "user");
      } else {
        updated = addConversation(updated!, "user", "Code changes requested.", "user");
      }
      addActivity(taskId, "code_changes_requested", "user", body?.message);
      broadcastSSE("task_updated", updated);
      break;
    }

    case "request_ai_review": {
      if (task.status !== TaskStatus.WaitingCodeReview) {
        return errorResponse("task must be in Waiting Code Review status");
      }
      updated = recordHistory(task, TaskStatus.CodeReviewRequested);
      addConversation(updated!, "user", "AI code review requested.", "user");
      addActivity(taskId, "ai_review_requested", "user");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "complete": {
      if (task.status !== TaskStatus.Merged) {
        return errorResponse("task must be in Merged status");
      }
      updated = recordHistory(task, TaskStatus.Complete);
      addConversation(updated!, "user", "Task completed.", "user");
      addActivity(taskId, "task_completed", "user");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "cancel": {
      if (CANCELED_CANT_CANCEL.has(task.status)) {
        return errorResponse("task cannot be canceled in its current status");
      }
      updated = recordHistory(task, TaskStatus.Canceled);
      addConversation(updated!, "user", "Task canceled.", "user");
      updated = updateTask(updated!.id, { assignedAgent: null });
      addActivity(taskId, "task_canceled", "user");
      broadcastSSE("task_updated", updated);
      break;
    }

    case "comment": {
      if (!body?.message) {
        return errorResponse("message is required");
      }
      updated = addConversation(task, body.authorName ?? "user", body.message, "user");
      addActivity(taskId, "comment_added", body.authorName ?? "user", body.message);
      broadcastSSE("task_updated", updated);
      break;
    }

    case "unblock": {
      const unblockMap: Partial<Record<TaskStatus, TaskStatus>> = {
        [TaskStatus.Planning]: TaskStatus.PlanChangesRequested,
        [TaskStatus.Coding]: TaskStatus.ChangesRequested,
        [TaskStatus.Reviewing]: TaskStatus.CodeReviewRequested,
      };
      const target = unblockMap[task.status];
      if (!target) {
        return errorResponse("task cannot be unblocked in its current status");
      }
      updated = recordHistory(task, target);
      updated = updateTask(updated!.id, { assignedAgent: null });
      addConversation(updated!, "user", `Task unblocked. Reverted to ${target}.`, "user");
      addActivity(taskId, "task_unblocked", "user", `Reverted to ${target}`);
      broadcastSSE("task_updated", updated);
      break;
    }

    default:
      return errorResponse("unknown action", 404);
  }

  if (updated) return jsonResponse(updated);
  return null;
});

const handleTaskById = wrapHandler(async (req, url) => {
  const taskId = getTaskIdFromUrl(url.pathname);
  if (!taskId || req.method === "POST") throw null;

  if (req.method === "GET") {
    const task = getTaskById(taskId);
    if (!task) return errorResponse("not found", 404);
    return jsonResponse(task);
  }

  if (req.method === "PUT") {
    const body = await parseBody(req);
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const task = updateTask(taskId, parsed.data);
    if (!task) return errorResponse("not found", 404);
    broadcastSSE("task_updated", task);
    return jsonResponse(task);
  }

  if (req.method === "DELETE") {
    const task = getTaskById(taskId);
    if (!task) return errorResponse("not found", 404);

    if (CANT_DELETE_STATUSES.has(task.status)) {
      return errorResponse("Task has reached coding stage and cannot be deleted.");
    }

    const hard = url.searchParams.get("hard") === "true";
    if (hard) {
      const deleted = deleteTask(taskId);
      if (!deleted) return errorResponse("not found", 404);
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const ok = softDeleteTask(taskId);
    if (!ok) return errorResponse("not found", 404);
    broadcastSSE("task_updated", { id: taskId, deletedAt: new Date().toISOString() });
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  return null;
});

const handleUnmatchedApi = wrapHandler(async (req, url) => {
  if (!url.pathname.startsWith("/api/")) throw null;
  return errorResponse("not found", 404);
});

async function handleDevProxy(req: Request, url: URL): Promise<Response | null> {
  if (!isDev) return null;
  return proxyToVite(req);
}

async function handleStatic(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname.startsWith("/api/")) return null;
  const staticResponse = await serveStatic(url);
  return staticResponse ?? null;
}

main();
