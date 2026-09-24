import type {
  Task,
  PaginatedResponse,
  ArchiveRunnerJob,
} from "@agentq/shared";
import {
  archiveTask,
  WorkflowError,
  getTasks,
  getTasksUpdatedSince,
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
  getActivityEvents,
  addUserComment,
  approveCode,
  approvePlan,
  cancelTask,
  completeTask,
  createTaskForProject,
  detectDefaultBranch,
  installedSkillVersions,
  reportBlocker,
  getFindings,
  sweepQueue,
  requestAiReview,
  requestCodeChanges,
  requestPlanChanges,
  resolveBlocker,
  skillsBundleVersion,
  submitCode,
  submitMerge,
  submitPlan,
  submitReview,
  unblockTask,
  createTaskSchema,
  updateTaskSchema,
  createProjectSchema,
  updateProjectSchema,
  transitionTaskSchema,
  paginationSchema,
  createRunnerSchema,
  updateRunnerSchema,
  runnerToolSchema,
  createRunner,
  getRunners,
  getRunnerById,
  updateRunner,
  deleteRunner,
  paginate,
  validateEnv,
} from "@agentq/shared";
import { getRunnerEngine, listTools } from "./runner/runner.js";
import { discoverModels } from "./runner/models.js";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { resolve, extname } from "path";

const env = validateEnv();
const PORT = env.PORT;
let isDev = process.argv.includes("--dev");

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
  stopDbWatcher();
}

// MCP servers (started by coding tools and runner jobs) write straight to SQLite,
// bypassing this process.
// While someone is listening we poll tasks.updated_at and re-broadcast changes.
const DB_WATCH_INTERVAL_MS = 1500;
let dbWatcher: Timer | null = null;
let dbWatchCursor = new Date().toISOString();

function pollTaskChanges() {
  if (sseClients.size === 0) return;
  try {
    const changed = getTasksUpdatedSince(dbWatchCursor);
    for (const task of changed) {
      broadcastSSE("task_updated", task);
      if (task.updatedAt > dbWatchCursor) dbWatchCursor = task.updatedAt;
    }
  } catch (e) {
    console.error("[sse] task watcher failed:", e);
  }
}

function ensureDbWatcher() {
  if (dbWatcher) return;
  dbWatchCursor = new Date().toISOString();
  dbWatcher = setInterval(pollTaskChanges, DB_WATCH_INTERVAL_MS);
}

function stopDbWatcher() {
  if (dbWatcher) {
    clearInterval(dbWatcher);
    dbWatcher = null;
  }
}

const runnerEngine = getRunnerEngine({ broadcast: broadcastSSE });

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

function getRunnerIdFromUrl(pathname: string): string | null {
  const match = pathname.match(/^\/api\/runners\/([a-z0-9-]+)/);
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

export interface StartServerOptions {
  /** Port to listen on (0 = random free port). Defaults to env PORT. */
  port?: number;
  /** Enable dev-mode CORS headers and the Vite proxy. Defaults to `--dev` flag. */
  dev?: boolean;
}

export function startServer(opts: StartServerOptions = {}) {
  if (opts.dev !== undefined) isDev = opts.dev;

  const server = Bun.serve({
    port: opts.port ?? PORT,
    // SSE streams idle between events; the default 10 s idle timeout would
    // drop them before the 30 s keepalive comment goes out.
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const handlers: Array<(req: Request, url: URL) => Promise<Response | null>> = [
        handleOptions,
        handleSSE,
        handleGetAgents,
        handleProjects,
        handleProjectById,
        handleActivity,
        handleRunnerTools,
        handleRunnerToolModels,
        handleRunners,
        handleRunnerById,
        handleMeta,
        handleTasksList,
        handleCreateTask,
        handleTaskSubActions,
        handleTaskDetails,
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

  return server;
}

async function main() {
  if (isDev) {
    console.log("[server] starting in dev mode, launching Vite...");
    await startVite();
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopVite();
    stopKeepAlive();
    await runnerEngine.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  const server = startServer();
  // Runner jobs do not survive a restart: give their tasks back before runners claim again.
  runnerEngine.recoverOrphans();
  runnerEngine.startEnabledRunners();
  // Expired claims of silent sessions and reviews nobody eligible picked up.
  const sweep = () => {
    try {
      const { expired, starved } = sweepQueue();
      for (const id of [...expired, ...starved]) {
        const task = getTaskById(id);
        if (task) broadcastSSE("task_updated", task);
      }
    } catch (e) {
      console.error("[sweeper]", e);
    }
  };
  sweep();
  setInterval(sweep, 60_000);

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
      // Flush headers right away so clients see the stream open before the first event.
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      ensureKeepAlive();
      ensureDbWatcher();
      req.signal?.addEventListener("abort", () => {
        sseClients.delete(controller);
        if (sseClients.size === 0) stopDbWatcher();
        try {
          controller.close();
        } catch {}
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
    const project = createProject({
      ...parsed.data,
      defaultMergeBranch:
        parsed.data.defaultMergeBranch || detectDefaultBranch(parsed.data.workingDirectory),
    });
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

// ─── Runners ────────────────────────────────────────────────────────

function runnerWithState(runner: NonNullable<ReturnType<typeof getRunnerById>>) {
  return { ...runner, state: runnerEngine.getState(runner.id) };
}

/** Runner jobs (still in this server's job history) that worked on a task, for its archive. */
function runnerJobsForTask(taskId: string): ArchiveRunnerJob[] {
  return getRunners().flatMap((runner) =>
    runnerEngine
      .getJobs(runner.id)
      .filter((job) => job.taskId === taskId)
      .map((job) => ({
        runnerName: runner.name,
        tool: runner.tool,
        phase: job.phase,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt ?? null,
        exitCode: job.exitCode ?? null,
        logPath: job.logPath,
      })),
  );
}

const handleRunnerTools = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/runners/tools" || req.method !== "GET") throw null;
  return jsonResponse(await listTools());
});

// GET /api/runners/tools/:tool/models[?refresh=1] — models + effort levels a tool accepts.
const handleRunnerToolModels = wrapHandler(async (req, url) => {
  const match = url.pathname.match(/^\/api\/runners\/tools\/([a-z0-9-]+)\/models\/?$/);
  if (!match || req.method !== "GET") throw null;
  const parsedTool = runnerToolSchema.safeParse(match[1]);
  if (!parsedTool.success) return errorResponse(`unknown tool: ${match[1]}`);
  const tool = parsedTool.data;
  const refresh = url.searchParams.get("refresh");
  const force = refresh === "1" || refresh === "true";
  try {
    return jsonResponse(await discoverModels(tool, undefined, { force }));
  } catch (e: any) {
    console.error(`[runner] model discovery failed for ${tool}:`, e?.message ?? e);
    return jsonResponse({ tool, source: "static", models: [], efforts: null, defaultEffort: null });
  }
});

const handleRunners = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/runners") throw null;
  if (req.method === "GET") {
    return jsonResponse(getRunners().map(runnerWithState));
  }
  if (req.method === "POST") {
    const body = await parseBody(req);
    const parsed = createRunnerSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
    }
    if (parsed.data.projectId && !getProjectById(parsed.data.projectId)) {
      return errorResponse("project not found", 404);
    }
    const runner = createRunner(parsed.data);
    if (runner.enabled) runnerEngine.start(runner.id);
    const result = runnerWithState(runner);
    broadcastSSE("runner_updated", result.state);
    return jsonResponse(result, 201);
  }
  return null;
});

const handleRunnerById = wrapHandler(async (req, url) => {
  const id = getRunnerIdFromUrl(url.pathname);
  // `/api/runners/tools` and `/api/runners/tools/<tool>/models` are not runner ids.
  if (!id || id === "tools" || url.pathname.startsWith("/api/runners/tools/")) throw null;
  const runner = getRunnerById(id);
  if (!runner) return errorResponse("not found", 404);
  const rest = url.pathname.slice(`/api/runners/${id}`.length);

  if (rest === "" || rest === "/") {
    if (req.method === "GET") return jsonResponse(runnerWithState(runner));
    if (req.method === "PUT") {
      const body = await parseBody(req);
      const parsed = updateRunnerSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
      }
      if (parsed.data.projectId && !getProjectById(parsed.data.projectId)) {
        return errorResponse("project not found", 404);
      }
      const updated = updateRunner(id, parsed.data)!;
      if (parsed.data.enabled === true && !runnerEngine.isRunning(id)) runnerEngine.start(id);
      if (parsed.data.enabled === false && runnerEngine.isRunning(id)) await runnerEngine.stop(id);
      return jsonResponse(runnerWithState(updated));
    }
    if (req.method === "DELETE") {
      await runnerEngine.stop(id, "Runner deleted");
      deleteRunner(id);
      broadcastSSE("runner_deleted", { id });
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    return null;
  }

  if (req.method === "POST" && rest === "/start") {
    updateRunner(id, { enabled: true });
    runnerEngine.start(id);
    return jsonResponse(runnerWithState(getRunnerById(id)!));
  }
  if (req.method === "POST" && rest === "/stop") {
    updateRunner(id, { enabled: false });
    await runnerEngine.stop(id);
    return jsonResponse(runnerWithState(getRunnerById(id)!));
  }
  if (req.method === "GET" && rest === "/jobs") {
    return jsonResponse(runnerEngine.getJobs(id));
  }
  const logMatch = rest.match(/^\/jobs\/([a-z0-9-]+)\/log$/);
  if (req.method === "GET" && logMatch) {
    const job = runnerEngine.getJob(id, logMatch[1]);
    if (!job) return errorResponse("not found", 404);
    const tailParam = Number(url.searchParams.get("tail") ?? "200");
    const tail = Number.isFinite(tailParam) && tailParam > 0 ? Math.min(tailParam, 5000) : 200;
    return new Response(runnerEngine.readLog(job, tail), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", ...corsHeaders() },
    });
  }
  return null;
});

/** Server facts the portal shows: skills bundle vs. installed skills, and so on. */
const handleMeta = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/meta" || req.method !== "GET") throw null;
  const skillsVersion = skillsBundleVersion();
  const installed = installedSkillVersions();
  const outdated = Object.entries(installed)
    .filter(([, v]) => v !== null && v !== skillsVersion)
    .map(([tool]) => tool);
  return jsonResponse({ skillsVersion, installedSkills: installed, outdatedSkills: outdated });
});

const handleTasksList = wrapHandler(async (req, url) => {
  if (url.pathname !== "/api/tasks" || req.method !== "GET") throw null;
  const pagination = paginationSchema.safeParse({
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  const { limit, offset } = pagination.success ? pagination.data : { limit: 50, offset: 0 };
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const allTasks = getTasks(projectId, { includeArchived });
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
  let task: Task;
  try {
    task = createTaskForProject(parsed.data, "user");
  } catch (e) {
    if (e instanceof WorkflowError) return errorResponse(e.message);
    throw e;
  }
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
    "add-comment": "comment",
  };
  const action = actionMap[subAction] ?? subAction.replace(/-/g, "_");
  const parsed = transitionTaskSchema.safeParse({ ...body, action });
  if (!parsed.success) {
    return errorResponse(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const data = parsed.data;
  const auth = { claimToken: data.claimToken };
  const author = data.authorName;

  // Each action is one shared workflow call; the workflow checks the status.
  const actions: Record<string, () => Task | Response> = {
    submit_plan: () =>
      submitPlan(taskId, { message: data.message, author, context: data.context, ...auth }).task,
    submit_code: () =>
      submitCode(taskId, {
        message: data.message,
        author,
        context: data.context,
        worktree: typeof body?.worktree === "string" ? body.worktree : undefined,
        ...auth,
      }).task,
    submit_review: () => {
      if (!data.verdict) return errorResponse("verdict is required (approve, request_changes or needs_human)");
      return submitReview(taskId, {
        verdict: data.verdict,
        findings: Array.isArray(body?.findings) ? body.findings : [],
        verifiedFindings: Array.isArray(body?.verifiedFindings) ? body.verifiedFindings : [],
        question: data.question,
        message: data.message,
        author,
        context: data.context,
        ...auth,
      }).task;
    },
    submit_merge: () => {
      if (!body?.branch || !body?.commit || !body?.authors) {
        return errorResponse("branch, commit, and authors are required");
      }
      return submitMerge(taskId, {
        branch: String(body.branch),
        commit: String(body.commit),
        authors: String(body.authors),
        worktree: typeof body.worktree === "string" ? body.worktree : undefined,
        message: data.message,
        author,
        context: data.context,
        ...auth,
      }).task;
    },
    report_blocker: () => {
      if (!body?.reason || !body?.question) return errorResponse("reason and question are required");
      return reportBlocker(taskId, {
        reason: String(body.reason),
        question: String(body.question),
        author,
        context: data.context,
        ...auth,
      }).task;
    },
    approve_plan: () => approvePlan(taskId, { message: data.message }),
    request_plan_changes: () => requestPlanChanges(taskId, { message: data.message }),
    approve_code: () => approveCode(taskId, { message: data.message }),
    request_code_changes: () => requestCodeChanges(taskId, { message: data.message }),
    request_ai_review: () => requestAiReview(taskId),
    complete: () => completeTask(taskId),
    cancel: () => cancelTask(taskId, { message: data.message }),
    unblock: () => unblockTask(taskId),
    resolve_blocker: () => {
      if (!data.targetStatus) return errorResponse("targetStatus is required");
      return resolveBlocker(taskId, { answer: data.answer ?? data.message ?? "", targetStatus: data.targetStatus });
    },
    comment: () => {
      if (!data.message) return errorResponse("message is required");
      return addUserComment(taskId, { message: data.message, author: author ?? "user" });
    },
    archive: () => {
      const result = archiveTask(taskId, {
        force: data.force,
        pullRequests: data.pullRequests,
        overview: data.overview,
        actor: author ?? "user",
        runnerJobs: runnerJobsForTask(taskId),
      });
      broadcastSSE("task_updated", result.task);
      return jsonResponse(result);
    },
  };

  const run = actions[action];
  if (!run) return errorResponse("unknown action", 404);
  let result: Task | Response;
  try {
    result = run();
  } catch (e) {
    if (e instanceof WorkflowError) return errorResponse(e.message);
    throw e;
  }
  if (result instanceof Response) return result;
  // A person took the task away from its agent: stop the job still working on it.
  if (["cancel", "unblock", "resolve_blocker"].includes(action)) {
    runnerEngine.abandonTask(taskId, `task ${action.replace("_", " ")} from the portal`);
  }
  broadcastSSE("task_updated", result);
  return jsonResponse(result);
});

/** Records kept beside a task (review findings); fetched separately from the task itself. */
const handleTaskDetails = wrapHandler(async (req, url) => {
  const match = url.pathname.match(/^\/api\/tasks\/([a-z0-9-]+)\/details$/);
  if (!match || req.method !== "GET") throw null;
  const task = getTaskById(match[1]);
  if (!task) return errorResponse("not found", 404);
  return jsonResponse({ findings: getFindings(task.id) });
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

if (import.meta.main) main();
