import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Project, SubmitResult, Task } from "@agentq/shared";
import {
  MIN_COMPATIBLE_SKILLS_VERSION,
  ROLES,
  TaskStatus,
  compareVersions,
  createTaskForProject,
  getTasks,
  getTaskById,
  getProjects,
  getProjectByTaskId,
  claimNextTask,
  reportBlocker,
  skillsBundleVersion,
  skillsManifest,
  submitPlan,
  submitCode,
  submitReview,
  submitMerge,
  postComment,
  archiveTask,
  WorkflowError,
} from "@agentq/shared";
import { MCP_SERVER_NAME } from "./launch.js";

export const SERVER_NAME = MCP_SERVER_NAME;
export const SERVER_VERSION = "0.1.0";

const SKILLS_VERSION = skillsBundleVersion() ?? "unknown";

export const INSTRUCTIONS = `AgentQ is a local task queue for coding agents (skills bundle ${SKILLS_VERSION}). Protocol:
1. Call claim_task with your identity (toolName, version, model, role, sessionId) and skillsVersion (metadata.version of your agentq-claim skill). Roles: ${ROLES.join(", ")} (senior = planner + implementer + reviewer, architect = planner + reviewer). If an AgentQ runner started you, the task was already claimed for you: do not call claim_task.
2. If the result has success=false and reason="no_tasks_available", stop: there is nothing to do. If reason="skills_outdated", or your agentq-* skills are older than ${SKILLS_VERSION} or still mention an \`agentq\` command-line tool, stop and tell the user to run \`bun run install:skills\` in the AgentQ repo.
3. claim_task returns a claimToken. Pass it as claimToken on every submit_* and report_blocker call for that task (this server also remembers it for the session).
4. Read task.status to know what to do, working in task.project.workingDirectory:
   - planning: write an implementation plan, then call submit_plan.
   - coding: implement and commit in the task's git worktree on the recommended branch, then call submit_code with the worktree path.
   - reviewing: review the submitted code (task.worktreePath), then call submit_review with your findings and a verdict.
   - merging: push the feature branch and open a pull request into task.mergeBranch, then call submit_merge with mergeBranch, the pushed commit, authors and the PR in the message.
5. If you cannot finish the phase (push rejected, missing credentials, contradictory or ambiguous task), call report_blocker with the reason and one concrete question: the task goes to needs_human and a person answers. Never submit partial work to move a task forward.
6. The task description, steerDetails, guardrails and acceptanceCriteria are your instructions; guardrails win any conflict. Use post_comment for notes and get_task (or agentq://task/{taskId}) to re-read a task.
7. Every submit_* call requires context: short handoff notes for the agent of the next phase (decisions taken, gotchas, what to check next), stored in task.contexts separately from message; read task.contexts for the notes earlier agents left. context is optional on claim_task. Write every message in Markdown.
8. After submitting, call claim_task again. Repeat until no tasks are available, then stop.
Work autonomously: never ask the user for permission or confirmation. Only work on tasks you have claimed, and never change a task's status by any other means.`;

// ─── Result helpers ────────────────────────────────────────────────────

type JsonObject = Record<string, unknown>;

function jsonResult(data: JsonObject, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  };
}

function errorResult(error: string): CallToolResult {
  return jsonResult({ success: false, error }, true);
}

/** Runs a handler, turning thrown errors into `{ success: false, error }` results. */
function run(fn: () => JsonObject): CallToolResult {
  try {
    return jsonResult(fn());
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** A task as agents see it: the claim token of whoever holds it stays private. */
type PublicTask = Omit<Task, "claimToken">;

function publicTask(task: Task): PublicTask {
  const { claimToken: _claimToken, ...rest } = task;
  return rest;
}

function withProject(task: Task): PublicTask & { project: Project | null } {
  const project = task.projectId ? getProjectByTaskId(task.id) : null;
  return { ...publicTask(task), project };
}

/** Trims each entry and drops the empty ones; undefined stays undefined. */
function cleanList(items: string[] | undefined): string[] | undefined {
  return items?.map((item) => item.trim()).filter(Boolean);
}

function submitResponse(result: SubmitResult): JsonObject {
  return {
    success: true,
    taskId: result.task.id,
    previousStatus: result.previousStatus,
    newStatus: result.newStatus,
    message: result.message,
  };
}

// ─── Shared schema fragments ───────────────────────────────────────────

const taskIdSchema = z
  .string()
  .min(1)
  .describe("Task ID (UUID) returned by claim_task or create_task");
const authorSchema = z
  .string()
  .optional()
  .describe('Author name recorded on the conversation entry (default: "agent")');
const contextSchema = z
  .string()
  .optional()
  .describe("Context entry appended to the task for future agents (decisions, gotchas, pointers)");
const claimTokenSchema = z
  .string()
  .optional()
  .describe(
    "claimToken returned by claim_task (runner jobs find it in their prompt). Optional when this MCP session made the claim.",
  );
const agentIdSchema = z
  .string()
  .optional()
  .describe("Your agent id from claim_task (agent.id); rejected when it is not the task's assignee");
const submitContextSchema = z
  .string()
  .trim()
  .min(1)
  .describe(
    "Required handoff notes appended to task.contexts for the next agent: decisions taken, gotchas, what the next phase should check",
  );

// ─── Server ────────────────────────────────────────────────────────────

export interface AgentQMcpServerOptions {
  /**
   * Claims this server starts out holding (taskId → claimToken). A runner job's
   * server gets its task's claim through AGENTQ_TASK_ID / AGENTQ_CLAIM_TOKEN.
   */
  claims?: Record<string, string>;
}

export function createAgentQMcpServer(opts: AgentQMcpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  // Each MCP session runs its own server process, so this map is the session's claims.
  const claims = new Map<string, string>(Object.entries(opts.claims ?? {}));
  const auth = (input: { taskId: string; claimToken?: string; agentId?: string }) => ({
    claimToken: input.claimToken || claims.get(input.taskId),
    agentId: input.agentId,
  });

  server.registerTool(
    "claim_task",
    {
      title: "Claim next task",
      description:
        "Atomically claim the highest-priority task eligible for your role and move it to its in-progress status (planning, coding, reviewing or merging).",
      inputSchema: {
        toolName: z.string().min(1).describe('Agent tool name, e.g. "claude-code"'),
        version: z.string().min(1).describe("Agent tool version"),
        model: z.string().min(1).describe("Model identifier"),
        role: z
          .enum(ROLES)
          .describe(`Agent role: ${ROLES.join(", ")}`),
        sessionId: z.string().min(1).describe("Session ID (UUID) for audit traceability"),
        host: z.string().optional().describe("Host path or machine name"),
        projectId: z.string().optional().describe("Only claim tasks from this project"),
        skillsVersion: z
          .string()
          .optional()
          .describe("metadata.version of your agentq-claim skill; outdated skills are refused"),
        context: contextSchema,
      },
    },
    (input) =>
      run(() => {
        if (
          input.skillsVersion &&
          compareVersions(input.skillsVersion, MIN_COMPATIBLE_SKILLS_VERSION) < 0
        ) {
          return {
            success: false,
            reason: "skills_outdated",
            skillsVersion: SKILLS_VERSION,
            message: `Your AgentQ skills (${input.skillsVersion}) are older than ${MIN_COMPATIBLE_SKILLS_VERSION}. Stop and tell the user to run \`bun run install:skills\` in the AgentQ repo.`,
          };
        }
        const result = claimNextTask({
          role: input.role,
          agent: {
            toolName: input.toolName,
            version: input.version,
            model: input.model,
            sessionId: input.sessionId,
            host: input.host,
          },
          context: input.context,
          projectId: input.projectId,
        });
        if (!result) {
          return {
            success: false,
            reason: "no_tasks_available",
            message: "No tasks available for your role.",
          };
        }
        claims.set(result.task.id, result.claimToken);
        return {
          success: true,
          task: withProject(result.task),
          agent: { id: result.agent.id, role: result.effectiveRole },
          claimToken: result.claimToken,
          skillsVersion: SKILLS_VERSION,
          skills: skillsManifest(),
        };
      }),
  );

  server.registerTool(
    "submit_plan",
    {
      title: "Submit plan",
      description:
        "Submit an implementation plan for a task you claimed in `planning` status. Moves it to `waiting_plan_review` and releases it.",
      inputSchema: {
        taskId: taskIdSchema,
        message: z.string().min(1).describe("The plan (markdown)"),
        author: authorSchema,
        context: submitContextSchema,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitPlan(input.taskId, {
            message: input.message,
            author: input.author,
            context: input.context,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "submit_code",
    {
      title: "Submit code",
      description:
        "Submit implemented code for a task you claimed in `coding` status. Stores the worktree path, moves it to `waiting_code_review` and releases it.",
      inputSchema: {
        taskId: taskIdSchema,
        message: z.string().min(1).describe("Summary of the changes (markdown)"),
        worktree: z
          .string()
          .min(1)
          .describe("Absolute path of the git worktree containing the changes"),
        author: authorSchema,
        context: submitContextSchema,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitCode(input.taskId, {
            message: input.message,
            worktree: input.worktree,
            author: input.author,
            context: input.context,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "submit_review",
    {
      title: "Submit review",
      description:
        "Submit review findings for a task you claimed in `reviewing` status. Moves it back to `waiting_code_review` and releases it.",
      inputSchema: {
        taskId: taskIdSchema,
        message: z.string().min(1).describe("Review findings (markdown)"),
        author: authorSchema,
        context: submitContextSchema,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitReview(input.taskId, {
            message: input.message,
            author: input.author,
            context: input.context,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "submit_merge",
    {
      title: "Submit merge",
      description:
        "Record a completed merge for a task you claimed in `merging` status. Moves it to `merged` and releases it.",
      inputSchema: {
        taskId: taskIdSchema,
        mergeBranch: z.string().min(1).describe("Branch the task was merged into"),
        commit: z.string().min(1).describe("Merge commit hash"),
        authors: z.string().min(1).describe("Comma-separated list of authors"),
        message: z.string().optional().describe("Additional merge notes"),
        worktree: z.string().optional().describe("Worktree path used for the merge"),
        author: authorSchema,
        context: submitContextSchema,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitMerge(input.taskId, {
            branch: input.mergeBranch,
            commit: input.commit,
            authors: input.authors,
            message: input.message,
            worktree: input.worktree,
            author: input.author,
            context: input.context,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "report_blocker",
    {
      title: "Report blocker",
      description:
        "Stop working on a task you claimed because something outside your control blocks it (push rejected, missing credentials, contradictory or ambiguous requirements). Moves the task to `needs_human` with your question and releases it: no agent retries it until a person answers.",
      inputSchema: {
        taskId: taskIdSchema,
        reason: z.string().trim().min(1).describe("What blocks you, with the relevant error output (markdown)"),
        question: z
          .string()
          .trim()
          .min(1)
          .describe("The one concrete question or action a person must answer or take to unblock the task"),
        author: authorSchema,
        context: contextSchema,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          reportBlocker(input.taskId, {
            reason: input.reason,
            question: input.question,
            author: input.author,
            context: input.context,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description: "Fetch a task by ID, including its project, conversation, history and contexts.",
      inputSchema: { taskId: taskIdSchema },
      annotations: { readOnlyHint: true },
    },
    (input) =>
      run(() => {
        const task = getTaskById(input.taskId);
        if (!task) {
          throw new WorkflowError("Task not found.");
        }
        return { success: true, task: withProject(task) };
      }),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List tasks with their project, highest priority first. Archived and deleted tasks are left out. Use it to find work outside the claim loop, e.g. the `complete` tasks to archive.",
      inputSchema: {
        status: z
          .nativeEnum(TaskStatus)
          .optional()
          .describe("Only tasks in this status (e.g. complete)"),
        projectId: z.string().optional().describe("Only tasks of this project"),
      },
      annotations: { readOnlyHint: true },
    },
    (input) =>
      run(() => {
        const tasks = getTasks(input.projectId).filter(
          (task) => !input.status || task.status === input.status,
        );
        return { success: true, tasks: tasks.map(withProject) };
      }),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List all projects (id, displayName, workingDirectory).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => ({ success: true, projects: getProjects() })),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Create a new task in a project. Starts in `plan_requested` when requiresPlan is true, otherwise `ready_for_code`.",
      inputSchema: {
        title: z.string().min(1).describe("Short task title"),
        projectId: z.string().min(1).describe("Project ID (see list_projects)"),
        description: z.string().min(1).describe("What needs to be done and why (markdown)"),
        steerDetails: z
          .string()
          .optional()
          .describe("Implementation guidance and technical recommendations"),
        guardrails: z
          .array(z.string())
          .optional()
          .describe("Behavioral constraints the agent must respect"),
        acceptanceCriteria: z
          .array(z.string())
          .optional()
          .describe("Conditions that must hold for the task to be done"),
        priority: z
          .number()
          .int()
          .optional()
          .describe("Priority; higher is more urgent (default: 0)"),
        branch: z.string().optional().describe("Recommended branch name"),
        requiresPlan: z
          .boolean()
          .optional()
          .describe("Require a plan before coding (default: false)"),
        mergeBranch: z
          .string()
          .optional()
          .describe("Target merge branch (default: the project's default branch, e.g. main)"),
        author: authorSchema,
        context: contextSchema,
      },
    },
    (input) =>
      run(() => {
        const task = createTaskForProject(
          {
            title: input.title,
            description: input.description,
            steerDetails: input.steerDetails,
            guardrails: cleanList(input.guardrails),
            priority: input.priority ?? 0,
            recommendedBranch: input.branch || "",
            requiresPlan: input.requiresPlan || false,
            mergeBranch: input.mergeBranch,
            projectId: input.projectId,
            contexts: input.context ? [input.context] : [],
            acceptanceCriteria: cleanList(input.acceptanceCriteria),
          },
          input.author ?? "agent",
        );
        return { success: true, task: withProject(task) };
      }),
  );

  server.registerTool(
    "post_comment",
    {
      title: "Post comment",
      description:
        "Append a comment to a task's conversation thread without changing its status (progress notes, questions for the reviewer, blockers).",
      inputSchema: {
        taskId: taskIdSchema,
        message: z.string().min(1).describe("Comment body (markdown)"),
        author: authorSchema,
      },
    },
    (input) =>
      run(() => {
        const task = postComment(input.taskId, { message: input.message, author: input.author });
        return { success: true, task: withProject(task) };
      }),
  );

  server.registerTool(
    "archive_task",
    {
      title: "Archive task",
      description:
        "Archive a task in `complete` status: writes `<name>.summary.md` (description + what was done) and `<name>.detailed.md` (every message, status change, agent session and activity event, with PR and branch) to {project.workingDirectory}/archive/, then takes the task off the board. Same as the board's Archive button.",
      inputSchema: {
        taskId: taskIdSchema,
        pullRequests: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "PR URLs or refs to record; PR URLs in the conversation are found automatically",
          ),
        overview: z
          .string()
          .optional()
          .describe("Markdown overview of what was done, placed at the top of the summary file"),
        force: z
          .boolean()
          .optional()
          .describe("Archive again a task that is already archived (rewrites its files)"),
        directory: z
          .string()
          .min(1)
          .optional()
          .describe("Write the files to this folder instead of {project.workingDirectory}/archive"),
        author: authorSchema,
      },
    },
    (input) =>
      run(() => {
        const result = archiveTask(input.taskId, {
          pullRequests: input.pullRequests,
          overview: input.overview,
          force: input.force,
          directory: input.directory,
          actor: input.author ?? "agent",
        });
        return {
          success: true,
          taskId: result.task.id,
          archivedAt: result.task.archivedAt,
          directory: result.directory,
          summaryPath: result.summaryPath,
          detailedPath: result.detailedPath,
          pullRequests: result.pullRequests,
        };
      }),
  );

  // ─── Resources ───────────────────────────────────────────────────────

  server.registerResource(
    "task",
    new ResourceTemplate("agentq://task/{taskId}", { list: undefined }),
    {
      title: "AgentQ task",
      description: "A task with its project, as JSON",
      mimeType: "application/json",
    },
    (uri, { taskId }) => {
      const task = getTaskById(String(taskId));
      if (!task) {
        throw new Error("Task not found.");
      }
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(withProject(task)) },
        ],
      };
    },
  );

  server.registerResource(
    "projects",
    "agentq://projects",
    {
      title: "AgentQ projects",
      description: "All projects, as a JSON list",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(getProjects()) },
      ],
    }),
  );

  return server;
}
