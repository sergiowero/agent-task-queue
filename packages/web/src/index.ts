import {
  createTask, getTasks, getTaskById, updateTask, deleteTask,
  getAgents,
  createProject, getProjects, getProjectById, updateProject, deleteProject,
  addActivityEvent, getActivityEvents,
  TaskStatus, Task,
} from "@agentq/shared";
import { spawn, ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import { resolve, extname } from "path";

const PORT = parseInt(process.env.PORT || "3000", 10);
const isDev = process.argv.includes("--dev");

// ─── Dev mode: Vite child process ─────────────────────────────────────

let viteProcess: ChildProcess | null = null;

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
  });

  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://localhost:5173");
      if (res.ok) {
        console.log("[vite] dev server ready");
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  console.warn("[vite] did not become ready within 60s, continuing anyway");
}

function stopVite() {
  if (viteProcess) {
    viteProcess.kill();
    viteProcess = null;
  }
}

// ─── Dev proxy ────────────────────────────────────────────────────────

async function proxyToVite(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `http://localhost:5173${url.pathname}${url.search}`;
  return fetch(target, {
    method: req.method,
    headers: req.headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
  });
}

// ─── Static file serving (production) ─────────────────────────────────

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

async function serveStatic(url: URL): Promise<Response | null> {
  const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const file = Bun.file(DIST_DIR + filePath);
    const stat = await file.stat();
    if (!stat || !stat.size) {
      if (!filePath.startsWith("/api")) {
        const indexFile = Bun.file(DIST_DIR + "/index.html");
        const indexStat = await indexFile.stat();
        if (indexStat && indexStat.size) {
          return new Response(indexFile, {
            headers: {
              "Content-Type": "text/html",
              "Cache-Control": "no-cache",
            },
          });
        }
      }
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
    if (!filePath.startsWith("/api")) {
      try {
        const indexFile = Bun.file(DIST_DIR + "/index.html");
        const indexStat = await indexFile.stat();
        if (indexStat && indexStat.size) {
          return new Response(indexFile, {
            headers: {
              "Content-Type": "text/html",
              "Cache-Control": "no-cache",
            },
          });
        }
      } catch {}
    }
    return null;
  }
}

// ─── SSE Connections ──────────────────────────────────────────────────

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

function startKeepAlive() {
  if (sseKeepAlive) return;
  sseKeepAlive = setInterval(() => {
    if (sseClients.size === 0) {
      if (sseKeepAlive) clearInterval(sseKeepAlive);
      sseKeepAlive = null;
      return;
    }
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

// ─── Helpers ──────────────────────────────────────────────────────────

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
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function getTaskIdFromUrl(url: string): string | null {
  const match = url.match(/\/api\/tasks\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

function getSubAction(pathname: string): string | null {
  const match = pathname.match(/\/api\/tasks\/[a-f0-9-]+\/(.+)/);
  return match ? match[1] : null;
}

// ─── Workflow Helpers ─────────────────────────────────────────────────

const CANCELED_CANT_CANCEL = new Set([TaskStatus.Canceled, TaskStatus.Complete]);

function recordHistory(task: Task, newStatus: TaskStatus): Task {
  const now = new Date().toISOString();
  const history = [
    ...task.history,
    { pre_status: task.status, new_status: newStatus, timestamp: now },
  ];
  return updateTask(task.id, { status: newStatus, history })!;
}

function addConversation(task: Task, authorName: string, message: string, messageType?: string): Task {
  const now = new Date().toISOString();
  const conversation = [
    ...task.conversation,
    { authorName, timestamp: now, message, messageType: messageType ?? "agent" },
  ];
  return updateTask(task.id, { conversation })!;
}

function addActivity(taskId: string, eventType: string, actor: string, details?: string) {
  addActivityEvent({ eventType, taskId, actor, details });
}

// ─── Server ───────────────────────────────────────────────────────────

async function main() {
  if (isDev) {
    console.log("[server] starting in dev mode, launching Vite...");
    await startVite();
    process.on("SIGINT", () => { stopVite(); process.exit(0); });
    process.on("SIGTERM", () => { stopVite(); process.exit(0); });
  }

  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // ── SSE ──────────────────────────────────────────────────────────
      if (url.pathname === "/api/events" && req.method === "GET") {
        const stream = new ReadableStream({
          start(controller) {
            sseClients.add(controller);
            startKeepAlive();
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
      }

      // ── Agents (read-only) ───────────────────────────────────────────
      if (url.pathname === "/api/agents" && req.method === "GET") {
        const role = url.searchParams.get("role") ?? undefined;
        const tool = url.searchParams.get("tool") ?? undefined;
        return jsonResponse(getAgents({ role, tool }));
      }

      // ── Projects ─────────────────────────────────────────────────────
      if (url.pathname === "/api/projects") {
        if (req.method === "GET") return jsonResponse(getProjects());
        if (req.method === "POST") {
          const body = await parseBody(req);
          if (!body?.id || !body?.displayName || !body?.workingDirectory) {
            return errorResponse("id, displayName, workingDirectory are required");
          }
          try {
            const project = createProject(body);
            return jsonResponse(project, 201);
          } catch (e: any) {
            return errorResponse(e.message ?? "failed to create project");
          }
        }
      }

      if (url.pathname.startsWith("/api/projects/")) {
        const id = url.pathname.split("/").pop()!;
        if (req.method === "PUT") {
          const body = await parseBody(req);
          if (!body) return errorResponse("invalid request body");
          const project = updateProject(id, body);
          if (!project) return errorResponse("not found", 404);
          return jsonResponse(project);
        }
        if (req.method === "DELETE") {
          const deleted = deleteProject(id);
          if (!deleted) return errorResponse("not found", 404);
          return new Response(null, { status: 204, headers: corsHeaders() });
        }
      }

      // ── Activity ─────────────────────────────────────────────────────
      if (url.pathname === "/api/activity" && req.method === "GET") {
        const taskId = url.searchParams.get("taskId") ?? undefined;
        const agentId = url.searchParams.get("agentId") ?? undefined;
        const from = url.searchParams.get("from") ?? undefined;
        const to = url.searchParams.get("to") ?? undefined;
        const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined;
        return jsonResponse(getActivityEvents({ taskId, agentId, from, to, limit }));
      }

      // ── Tasks CRUD ───────────────────────────────────────────────────
      if (url.pathname === "/api/tasks") {
        if (req.method === "GET") {
          const projectId = url.searchParams.get("projectId") ?? undefined;
          return jsonResponse(getTasks(projectId));
        }
        if (req.method === "POST") {
          const body = await parseBody(req);
          if (!body?.title) return errorResponse("title is required");
          if (!body?.description) return errorResponse("description is required");
          if (!body?.projectId) return errorResponse("projectId is required");
          const task = createTask(body);
          addActivity(task.id, "task_created", "user");
          broadcastSSE("task_created", task);
          return jsonResponse(task, 201);
        }
      }

      // ── Task sub-actions (before generic :id match) ──────────────────
      const taskId = getTaskIdFromUrl(url.pathname);
      if (taskId && req.method === "POST") {
        const subAction = getSubAction(url.pathname);
        const task = getTaskById(taskId);
        if (!task) return errorResponse("not found", 404);

        let updated: Task | null = null;
        const body = await parseBody(req);

        switch (subAction) {
          // ── Submit plan ────────────────────────────────────────────
          case "submit-plan": {
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

          // ── Submit code ────────────────────────────────────────────
          case "submit-code": {
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

          // ── Submit review ──────────────────────────────────────────
          case "submit-review": {
            if (task.status !== TaskStatus.Reviewing) {
              return errorResponse("task must be in Reviewing status");
            }
            updated = recordHistory(task, TaskStatus.WaitingCodeReview);
            if (body?.message) {
              updated = addConversation(updated!, body.authorName ?? "agent", body.message, "review");
            }
            updated = updateTask(updated!.id, { assignedAgent: null });
            addActivity(taskId, "review_submitted", body?.authorName ?? "agent");
            broadcastSSE("task_updated", updated);
            break;
          }

          // ── Submit merge ───────────────────────────────────────────
          case "submit-merge": {
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
            updated = addConversation(updated!, body.authorName ?? "agent", `Merge submitted. ${mergeDetails}`, "merge");
            updated = updateTask(updated!.id, { assignedAgent: null });
            addActivity(taskId, "merge_submitted", body.authorName ?? "agent");
            broadcastSSE("task_updated", updated);
            break;
          }

          // ── Approve plan ───────────────────────────────────────────
          case "approve-plan": {
            if (task.status !== TaskStatus.WaitingPlanReview) {
              return errorResponse("task must be in Waiting Plan Review status");
            }
            updated = recordHistory(task, TaskStatus.ReadyForCode);
            addConversation(updated!, "user", "Plan approved.", "user");
            addActivity(taskId, "plan_approved", "user");
            broadcastSSE("task_updated", updated);
            break;
          }

          // ── Request plan changes ───────────────────────────────────
          case "request-plan-changes": {
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

          // ── Approve code ───────────────────────────────────────────
          case "approve-code": {
            if (task.status !== TaskStatus.WaitingCodeReview) {
              return errorResponse("task must be in Waiting Code Review status");
            }
            updated = recordHistory(task, TaskStatus.Approved);
            addConversation(updated!, "user", "Code approved.", "user");
            addActivity(taskId, "code_approved", "user");
            broadcastSSE("task_updated", updated);
            break;
          }

          // ── Request code changes ───────────────────────────────────
          case "request-code-changes": {
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

          // ── Request AI review ──────────────────────────────────────
          case "request-ai-review": {
            if (task.status !== TaskStatus.WaitingCodeReview) {
              return errorResponse("task must be in Waiting Code Review status");
            }
            updated = recordHistory(task, TaskStatus.CodeReviewRequested);
            addConversation(updated!, "user", "AI code review requested.", "user");
            addActivity(taskId, "ai_review_requested", "user");
            broadcastSSE("task_updated", updated);
            break;
          }

          // ── Confirm completion ─────────────────────────────────────
          case "confirm-completion": {
            if (task.status !== TaskStatus.Merged) {
              return errorResponse("task must be in Merged status");
            }
            updated = recordHistory(task, TaskStatus.Complete);
            addConversation(updated!, "user", "Task completed.", "user");
            addActivity(taskId, "task_completed", "user");
            broadcastSSE("task_updated", updated);
            break;
          }

          // ── Cancel ─────────────────────────────────────────────────
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

          // ── Unblock ────────────────────────────────────────────────
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
      }

      // ── Task GET / PUT / DELETE by ID ────────────────────────────────
      if (taskId) {
        if (req.method === "GET") {
          const task = getTaskById(taskId);
          if (!task) return errorResponse("not found", 404);
          return jsonResponse(task);
        }
        if (req.method === "PUT") {
          const body = await parseBody(req);
          if (!body) return errorResponse("invalid request body");
          const task = updateTask(taskId, body);
          if (!task) return errorResponse("not found", 404);
          broadcastSSE("task_updated", task);
          return jsonResponse(task);
        }
        if (req.method === "DELETE") {
          const deleted = deleteTask(taskId);
          if (!deleted) return errorResponse("not found", 404);
          return new Response(null, { status: 204, headers: corsHeaders() });
        }
      }

      // ── Tools: Install Binary (SSE) ────────────────────────────────
      if (url.pathname === "/api/tools/install/execute" && req.method === "POST") {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            const send = (event: string, data: string) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
            };

            const proc = spawn("bun", ["run", "install:bin"], {
              cwd: resolve(import.meta.dir, "../../.."),
              stdio: ["ignore", "pipe", "pipe"],
            });

            proc.stdout.on("data", (chunk: Buffer) => send("output", JSON.stringify(chunk.toString())));
            proc.stderr.on("data", (chunk: Buffer) => send("output", JSON.stringify(chunk.toString())));

            let stdoutClosed = false;
            let stderrClosed = false;
            proc.stdout.on("end", () => { stdoutClosed = true; if (stderrClosed) { send("done", JSON.stringify({ code: proc.exitCode })); controller.close(); } });
            proc.stderr.on("end", () => { stderrClosed = true; if (stdoutClosed) { send("done", JSON.stringify({ code: proc.exitCode })); controller.close(); } });

            proc.on("error", (err) => {
              send("error", err.message);
              controller.close();
            });

            req.signal?.addEventListener("abort", () => {
              proc.kill();
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
      }

      // ── Tools: Install Skills (SSE) ─────────────────────────────────
      if (url.pathname === "/api/tools/install/skills" && req.method === "POST") {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            const send = (event: string, data: string) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
            };

            const proc = spawn("bun", ["run", "install:skills"], {
              cwd: resolve(import.meta.dir, "../../.."),
              stdio: ["ignore", "pipe", "pipe"],
            });

            proc.stdout.on("data", (chunk: Buffer) => send("output", JSON.stringify(chunk.toString())));
            proc.stderr.on("data", (chunk: Buffer) => send("output", JSON.stringify(chunk.toString())));

            let stdoutClosed = false;
            let stderrClosed = false;
            proc.stdout.on("end", () => { stdoutClosed = true; if (stderrClosed) { send("done", JSON.stringify({ code: proc.exitCode })); controller.close(); } });
            proc.stderr.on("end", () => { stderrClosed = true; if (stdoutClosed) { send("done", JSON.stringify({ code: proc.exitCode })); controller.close(); } });

            proc.on("error", (err) => {
              send("error", err.message);
              controller.close();
            });

            req.signal?.addEventListener("abort", () => {
              proc.kill();
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
      }

      // ── Tools: Skill File ───────────────────────────────────────────
      if (url.pathname === "/api/tools/install/skill-file" && req.method === "GET") {
        try {
          const skillPath = resolve(import.meta.dir, "../../../skills/agentq-workflow/SKILL.md");
          const content = await readFile(skillPath, "utf-8");
          return jsonResponse({ content });
        } catch (e: any) {
          return errorResponse("Failed to read skill file: " + e.message, 500);
        }
      }

      // ── Unmatched /api/* → 404 ───────────────────────────────────────
      if (url.pathname.startsWith("/api/")) {
        return errorResponse("not found", 404);
      }

      // ── Dev mode: proxy to Vite ─────────────────────────────────────
      if (isDev) {
        return proxyToVite(req);
      }

      // ── Production: serve static files ───────────────────────────────
      const staticResponse = await serveStatic(url);
      if (staticResponse) {
        return staticResponse;
      }

      return errorResponse("not found", 404);
    },
  });

  console.log(`AgentQ Web Server running on http://localhost:${server.port}`);
}

main();
