import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Project, SubmitResult, Task } from "@agentq/shared";
import {
  createTask,
  getTaskById,
  getProjects,
  getProjectByTaskId,
  claimNextTask,
  submitPlan,
  submitCode,
  submitReview,
  submitMerge,
  postComment,
  WorkflowError,
} from "@agentq/shared";

export const SERVER_NAME = "agentq";
export const SERVER_VERSION = "0.1.0";

const ROLES = ["planner", "implementer", "reviewer", "senior", "architect"] as const;

export const INSTRUCTIONS = `AgentQ is a local task queue for coding agents. Protocol:
1. Call claim_task with your identity (toolName, version, model, role, sessionId). Roles: planner, implementer, reviewer, senior (all three), architect (planner + reviewer).
2. If the result has success=false and reason="no_tasks_available", stop: there is nothing to do.
3. Read task.status to know what to do, working in task.project.workingDirectory:
   - planning: write an implementation plan, then call submit_plan.
   - coding: implement in a git worktree on the recommended branch, then call submit_code with the worktree path.
   - reviewing: review the submitted code (task.worktreePath), then call submit_review with your findings.
   - merging: merge the task branch into task.mergeBranch, then call submit_merge with branch, commit and authors.
4. The task description, steerDetails, guardrails and acceptanceCriteria are your instructions; use post_comment for notes and get_task (or agentq://task/{taskId}) to re-read a task.
5. After submitting, call claim_task again. Repeat until no tasks are available, then stop.
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

function withProject(task: Task): Task & { project: Project | null } {
  const project = task.projectId ? getProjectByTaskId(task.id) : null;
  return { ...task, project };
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

// ─── Server ────────────────────────────────────────────────────────────

export function createAgentQMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "claim_task",
    {
      title: "Claim next task",
      description:
        "Atomically claim the highest-priority task eligible for your role and move it to its in-progress status (planning, coding, reviewing or merging). Same as `agentq claim --json`.",
      inputSchema: {
        toolName: z.string().min(1).describe('Agent tool name, e.g. "claude-code"'),
        version: z.string().min(1).describe("Agent tool version"),
        model: z.string().min(1).describe("Model identifier"),
        role: z
          .enum(ROLES)
          .describe("Agent role: planner, implementer, reviewer, senior or architect"),
        sessionId: z.string().min(1).describe("Session ID (UUID) for audit traceability"),
        host: z.string().optional().describe("Host path or machine name"),
        projectId: z.string().optional().describe("Only claim tasks from this project"),
        context: contextSchema,
      },
    },
    (input) =>
      run(() => {
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
        return {
          success: true,
          task: withProject(result.task),
          agent: { id: result.agent.id, role: result.effectiveRole },
        };
      }),
  );

  server.registerTool(
    "submit_plan",
    {
      title: "Submit plan",
      description:
        "Submit an implementation plan for a task you claimed in `planning` status. Moves it to `waiting_plan_review` and releases it. Same as `agentq submit-plan --json`.",
      inputSchema: {
        taskId: taskIdSchema,
        message: z.string().min(1).describe("The plan (markdown)"),
        author: authorSchema,
        context: contextSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitPlan(input.taskId, {
            message: input.message,
            author: input.author,
            context: input.context,
          }),
        ),
      ),
  );

  server.registerTool(
    "submit_code",
    {
      title: "Submit code",
      description:
        "Submit implemented code for a task you claimed in `coding` status. Stores the worktree path, moves it to `waiting_code_review` and releases it. Same as `agentq submit-code --json`.",
      inputSchema: {
        taskId: taskIdSchema,
        message: z.string().min(1).describe("Summary of the changes (markdown)"),
        worktree: z
          .string()
          .min(1)
          .describe("Absolute path of the git worktree containing the changes"),
        author: authorSchema,
        context: contextSchema,
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
          }),
        ),
      ),
  );

  server.registerTool(
    "submit_review",
    {
      title: "Submit review",
      description:
        "Submit review findings for a task you claimed in `reviewing` status. Moves it back to `waiting_code_review` and releases it. Same as `agentq submit-review --json`.",
      inputSchema: {
        taskId: taskIdSchema,
        message: z.string().min(1).describe("Review findings (markdown)"),
        author: authorSchema,
        context: contextSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitReview(input.taskId, {
            message: input.message,
            author: input.author,
            context: input.context,
          }),
        ),
      ),
  );

  server.registerTool(
    "submit_merge",
    {
      title: "Submit merge",
      description:
        "Record a completed merge for a task you claimed in `merging` status. Moves it to `merged` and releases it. Same as `agentq submit-merge --json`.",
      inputSchema: {
        taskId: taskIdSchema,
        mergeBranch: z.string().min(1).describe("Branch the task was merged into"),
        commit: z.string().min(1).describe("Merge commit hash"),
        authors: z.string().min(1).describe("Comma-separated list of authors"),
        message: z.string().optional().describe("Additional merge notes"),
        worktree: z.string().optional().describe("Worktree path used for the merge"),
        author: authorSchema,
        context: contextSchema,
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
          }),
        ),
      ),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description: "Fetch a task by ID, including its project. Same as `agentq get --json`.",
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
    "list_projects",
    {
      title: "List projects",
      description:
        "List all projects (id, displayName, workingDirectory). Same as `agentq projects --json`.",
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
        "Create a new task in a project. Starts in `plan_requested` when requiresPlan is true, otherwise `ready_for_code`. Same as `agentq create --json`.",
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
        mergeBranch: z.string().optional().describe("Target merge branch (default: develop)"),
        context: contextSchema,
      },
    },
    (input) =>
      run(() => {
        const task = createTask({
          title: input.title,
          description: input.description,
          steerDetails: input.steerDetails,
          guardrails: input.guardrails,
          priority: input.priority ?? 0,
          recommendedBranch: input.branch || "",
          requiresPlan: input.requiresPlan || false,
          mergeBranch: input.mergeBranch || "develop",
          projectId: input.projectId,
          contexts: input.context ? [input.context] : [],
          acceptanceCriteria: input.acceptanceCriteria,
        });
        return { success: true, task: { ...task, project: getProjectByTaskId(task.id) } };
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
