import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { IndependentBrief, IndependentPhase, Project, SubmitResult, Task } from "@agentq/shared";
import {
  MIN_COMPATIBLE_SKILLS_VERSION,
  CLAIM_RULES,
  DEFAULT_ROLES,
  ROLES,
  STATUS_INFO,
  skillForPhase,
  TaskStatus,
  compareVersions,
  createTaskForProject,
  getTasks,
  getTaskById,
  getProjects,
  getProjectByTaskId,
  claimNextTask,
  reportBlocker,
  getFindings,
  getEvidence,
  getHandoffs,
  buildAgentBrief,
  buildIndependentBrief,
  isIndependentPhase,
  listSkills,
  readSkill,
  referenceSchema,
  submitVerification,
  submitPlanReview,
  createSubtask,
  submitRefinement,
  criteriaInputSchema,
  riskSchema,
  taskTypeSchema,
  policyFor,
  skillsBundleVersion,
  sweepQueue,
  touchLease,
  authorSchema,
  contextSchema,
  submitPlanFields,
  submitCodeFields,
  submitReviewFields,
  submitPlanReviewFields,
  submitVerificationFields,
  submitRefinementFields,
  submitPrFields,
  reportBlockerFields,
  skillsManifest,
  submitPlan,
  submitCode,
  submitReview,
  submitPr,
  postComment,
  archiveTask,
  WorkflowError,
} from "@agentq/shared";
import { randomUUID } from "crypto";
import { MCP_SERVER_NAME } from "./launch.js";

export const SERVER_NAME = MCP_SERVER_NAME;
export const SERVER_VERSION = "0.1.0";

const SKILLS_VERSION = skillsBundleVersion() ?? "unknown";

export const INSTRUCTIONS = `AgentQ is a local task queue for coding agents (skills bundle ${SKILLS_VERSION}). Protocol:
1. Call claim_task with your identity (toolName, version, model, sessionId), your roles and skillsVersion (required: metadata.version of your agentq-claim skill; a client without the skills installed reads them with get_skill and passes ${SKILLS_VERSION}). A role is a phase you work: ${ROLES.join(", ")}. Pass one or more (e.g. ["plan", "review"]), or omit roles for all of them but verify (the server has a built-in verifier). If an AgentQ runner started you, the task was already claimed for you: do not call claim_task.
2. If the result has success=false and reason="no_tasks_available", stop: there is nothing to do. If reason="skills_outdated", or your agentq-* skills still mention an \`agentq\` command-line tool, stop and tell the user to run \`bun run install:all\` in the AgentQ repo (it installs the current skills and MCP registration for every tool it finds), then restart the tool. If only phaseSkill.version or the result's skillsVersion is newer than your installed skills, read the phase skill with get_skill, finish the task with it, then tell the user to run \`bun run install:all\`.
3. claim_task returns a claimToken. Pass it as claimToken on every submit_* and report_blocker call for that task (this server also remembers it for the session).
4. Read task.status to know what to do, working in task.project.workingDirectory; phaseSkill in the claim_task result names the agentq-* skill to follow:
   - refining (role refine): make the draft ready (testable criteria, type, risk, non-goals), then call submit_refinement.
   - planning (role plan): write an implementation plan with its validation plan, then call submit_plan.
   - plan_reviewing (role plan_review): critique the plan against the task and the codebase, then call submit_plan_review with a verdict and findings.
   - coding (role code): implement and commit in the task's git worktree on the recommended branch, then call submit_code with the worktree path.
   - verifying (role verify): run the validation plan's and the project's commands in the task's worktree, then call submit_verification.
   - reviewing (role review): review the submitted code (task.worktreePath), verify the previous round's findings by id, then call submit_review with a verdict (approve, request_changes, needs_human) and structured findings. The verdict routes the task: approve moves it on, request_changes sends it back to the coder with your findings.
   Plan critique, verification and code review are independent checks: their brief (and get_task, while you hold the task) has the task, the criteria, the plan and the findings to verify, never the author's conversation, handoffs, messages or evidence. Judge the work itself.
   - merging (role pr): push the feature branch and open a pull request into task.mergeBranch with the body in brief.pr.body, then call submit_pr with prUrl, mergeBranch, the pushed commit and authors. Never merge it yourself: the task waits in pr_open and completes when a person merges the PR on GitHub.
5. If you cannot finish the phase (push rejected, missing credentials, contradictory or ambiguous task), call report_blocker with the reason and one concrete question: the task goes to needs_human and a person answers. Never submit partial work to move a task forward.
6. The task description, steerDetails, guardrails and acceptanceCriteria are your instructions; guardrails win any conflict. Use post_comment for notes and get_task (or agentq://task/{taskId}) to re-read a task.
7. Every submit_* call takes context: short handoff notes for the agent of the next phase (decisions taken, gotchas, what to check next), stored separately from message, plus optional decisions, risks and next lists; the brief shows the latest handoff of each phase (except in the independent checks). context is required on every submit_* but submit_verification, where it is optional (the built-in verifier sends none) and expected from agents; it is optional on claim_task. Write every message in Markdown.
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
function runTool(fn: () => JsonObject): CallToolResult {
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

function projectOf(task: Task): Project | null {
  return task.projectId ? getProjectByTaskId(task.id) : null;
}

function withProject(task: Task): PublicTask & { project: Project | null } {
  return { ...publicTask(task), project: projectOf(task) };
}

/**
 * The task as an independent checker sees it: the brief's summary and the
 * project, without the conversation, contexts, handoffs or evidence.
 */
function independentTask(task: Task, brief: IndependentBrief) {
  return { ...brief.task, project: projectOf(task), independent: true as const };
}

/** A task with its project and its review findings (what an agent needs to continue it). */
function taskDetails(task: Task) {
  return {
    ...withProject(task),
    findings: getFindings(task.id),
    evidence: getEvidence(task.id),
    handoffs: getHandoffs(task.id),
  };
}

/** The skill the claimed status belongs to (e.g. agentq-code), with its version. */
function phaseSkillOf(status: Task["status"]) {
  const phase = STATUS_INFO[status]?.phase;
  const name = phase ? skillForPhase(phase) : null;
  const skill = name ? readSkill(name) : null;
  return skill ? { name: skill.name, version: skill.version } : null;
}

/**
 * The task without what grows with every round (conversation, history, contexts
 * and each criterion's evidence ids): claim_task pairs it with the brief, whose
 * size stays flat. get_task still returns all of it.
 */
function taskHeader(task: Task) {
  const { conversation: _c, history: _h, contexts: _x, ...rest } = withProject(task);
  return { ...rest, acceptanceCriteria: task.acceptanceCriteria.map(({ id, text, verify, status }) => ({ id, text, verify, status })) };
}

/** A task in a listing: enough to pick it (get_task has the rest). */
function taskSummary(task: Task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    type: task.type,
    risk: task.risk,
    projectId: task.projectId,
    project: projectOf(task),
    recommendedBranch: task.recommendedBranch,
    mergeBranch: task.mergeBranch,
    pullRequest: task.pullRequest,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
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
  // Each MCP session runs its own server process, so this map is the session's claims
  // and this id is the session's identity for separation of duties.
  const claims = new Map<string, string>(Object.entries(opts.claims ?? {}));
  const instanceId = randomUUID();
  const auth = (input: { taskId: string; claimToken?: string; agentId?: string }) => ({
    claimToken: input.claimToken || claims.get(input.taskId),
    agentId: input.agentId,
  });
  /** Any call from this session keeps its claims alive (hand-opened sessions have a lease). */
  const keepAlive = () => {
    for (const [taskId, token] of claims) touchLease(taskId, token);
  };
  const run = (fn: () => JsonObject): CallToolResult => {
    try {
      keepAlive();
    } catch {}
    return runTool(fn);
  };
  /** The phase in which this session checks `task`, when it holds it for a plan critique, verification or review. */
  const checkingPhase = (task: Task): IndependentPhase | null => {
    const phase = STATUS_INFO[task.status]?.phase;
    const holds = !!task.claimToken && claims.get(task.id) === task.claimToken;
    return holds && isIndependentPhase(phase) ? phase : null;
  };
  /** A task as this session may see it: an independent checker never gets the author's context. */
  const visibleTask = (task: Task) => {
    const phase = checkingPhase(task);
    return phase ? independentTask(task, buildIndependentBrief(task, phase)!) : withProject(task);
  };

  server.registerTool(
    "claim_task",
    {
      title: "Claim next task",
      description:
        "Atomically claim the highest-priority task one of your roles works and move it to its in-progress status (refining, planning, plan_reviewing, coding, verifying, reviewing or merging). A plan critique, verification or review claim comes with an independent brief: the task and what to check, never the author's context.",
      inputSchema: {
        toolName: z.string().min(1).describe('Agent tool name, e.g. "claude-code"'),
        version: z.string().min(1).describe("Agent tool version"),
        model: z.string().min(1).describe("Model identifier"),
        roles: z
          .array(z.enum(ROLES))
          .min(1)
          .optional()
          .describe(
            `The phases you work, one or more; each claims tasks in these statuses: ${CLAIM_RULES.map((r) => `${r.role} (${r.from.join(", ")})`).join("; ")}. Omit for all but verify.`,
          ),
        sessionId: z.string().min(1).describe("Session ID (UUID) for audit traceability"),
        host: z.string().optional().describe("Host path or machine name"),
        projectId: z.string().optional().describe("Only claim tasks from this project"),
        skillsVersion: z
          .string()
          .optional()
          .describe(
            "Required: metadata.version of your agentq-claim skill. A claim without it, or with skills older than the server supports, is refused with reason skills_outdated",
          ),
        context: contextSchema,
      },
    },
    (input) =>
      run(() => {
        // Skills that send no version predate it (or are missing): the server cannot trust them either.
        if (!input.skillsVersion || compareVersions(input.skillsVersion, MIN_COMPATIBLE_SKILLS_VERSION) < 0) {
          return {
            success: false,
            reason: "skills_outdated",
            skillsVersion: SKILLS_VERSION,
            message: `${
              input.skillsVersion
                ? `Your AgentQ skills (${input.skillsVersion}) are older than ${MIN_COMPATIBLE_SKILLS_VERSION}.`
                : "claim_task needs skillsVersion, the metadata.version of your agentq-claim skill: your AgentQ skills are missing or predate it."
            } Stop and tell the user to run \`bun run install:all\` in the AgentQ repo (it installs the current skills, ${SKILLS_VERSION}, and the MCP registration for every tool it finds), then restart the tool.`,
          };
        }
        sweepQueue();
        const result = claimNextTask({
          roles: input.roles ?? DEFAULT_ROLES,
          agent: {
            toolName: input.toolName,
            version: input.version,
            model: input.model,
            sessionId: input.sessionId,
            host: input.host,
          },
          context: input.context,
          projectId: input.projectId,
          sessionKey: `mcp:${instanceId}`,
        });
        if (!result) {
          return {
            success: false,
            reason: "no_tasks_available",
            message: "No tasks available for your roles.",
          };
        }
        claims.set(result.task.id, result.claimToken);
        const policy = policyFor(result.task);
        const brief = buildAgentBrief(result.task)!;
        return {
          success: true,
          task: "independent" in brief ? independentTask(result.task, brief) : taskHeader(result.task),
          brief,
          phaseSkill: phaseSkillOf(result.task.status),
          autonomy: policy.level,
          round: brief.round,
          agent: { id: result.agent.id, role: result.role },
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
        "Submit an implementation plan for a task you claimed in `planning` status, with its validation plan (how each acceptance criterion will be verified), open questions, your risk estimate and the paths it touches. Under autonomy L2+ an AI critic reviews it next (low-risk plans then go straight to coding); otherwise a person approves it. Once approved, the validation plan is frozen and the verifier runs its commands.",
      inputSchema: {
        taskId: taskIdSchema,
        ...submitPlanFields,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitPlan(input.taskId, {
            message: input.message,
            validationPlan: input.validationPlan,
            openQuestions: input.openQuestions,
            suggestedRisk: input.suggestedRisk,
            proposedSubtasks: input.proposedSubtasks,
            touchedPaths: input.touchedPaths,
            findingResolutions: input.findingResolutions,
            author: input.author,
            context: input.context,
            decisions: input.decisions,
            risks: input.risks,
            next: input.next,
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
        "Submit implemented code for a task you claimed in `coding` status, with the evidence you gathered per acceptance criterion and an answer for every open review finding. Stores the worktree path and releases the task: the verifier runs the project's commands next (when configured), then the review.",
      inputSchema: {
        taskId: taskIdSchema,
        ...submitCodeFields,
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
            branch: input.branch,
            headSha: input.headSha,
            evidence: input.evidence,
            criteria: input.criteria,
            findingResolutions: input.findingResolutions,
            author: input.author,
            context: input.context,
            decisions: input.decisions,
            risks: input.risks,
            next: input.next,
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
        "Submit a verdict and structured findings for a task you claimed in `reviewing`. The verdict routes the task: approve moves it on (to `approved`, or to a person when the task is high risk or sampled), request_changes sends it back to `changes_requested` with your findings (after the project's round limit a person decides), needs_human asks a person. Approve is refused while blocker or major findings are open. Under autonomy L0 the verdict is advice and a person decides.",
      inputSchema: {
        taskId: taskIdSchema,
        ...submitReviewFields,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitReview(input.taskId, {
            verdict: input.verdict,
            findings: input.findings,
            verifiedFindings: input.verifiedFindings,
            question: input.question,
            message: input.message,
            author: input.author,
            context: input.context,
            decisions: input.decisions,
            risks: input.risks,
            next: input.next,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "submit_verification",
    {
      title: "Submit verification",
      description:
        "With the `verify` role: report the result of running the task's verification commands for a task you claimed in `verifying`. Green goes on to review; red goes back to the coder with the evidence (after the project's limit, to a person).",
      inputSchema: {
        taskId: taskIdSchema,
        ...submitVerificationFields,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitVerification(input.taskId, {
            passed: input.passed,
            evidence: input.evidence,
            tampering: input.tampering,
            verifiedSha: input.verifiedSha,
            author: input.author,
            context: input.context,
            decisions: input.decisions,
            risks: input.risks,
            next: input.next,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "submit_plan_review",
    {
      title: "Submit plan critique",
      description:
        "Critique a plan for a task you claimed in `plan_reviewing`: a verdict and findings (ids P<round>-<n>). approve sends a low-risk plan straight to coding (otherwise to a person for approval); request_changes back to the planner (after the project's limit, to a person); needs_human asks a person. Approve is refused while blocker or major findings are open.",
      inputSchema: {
        taskId: taskIdSchema,
        ...submitPlanReviewFields,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitPlanReview(input.taskId, {
            verdict: input.verdict,
            findings: input.findings,
            verifiedFindings: input.verifiedFindings,
            suggestedRisk: input.suggestedRisk,
            question: input.question,
            message: input.message,
            author: input.author,
            context: input.context,
            decisions: input.decisions,
            risks: input.risks,
            next: input.next,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "create_subtask",
    {
      title: "Create subtask",
      description:
        "With the `plan` role, while you hold the parent in `planning`: split the work into a subtask (one reviewable PR, under ~400 changed lines). Subtasks are held until the parent's plan is approved; then they run (in blockedBy order) and the parent completes when they all do.",
      inputSchema: {
        taskId: taskIdSchema.describe("The parent task you are planning"),
        title: z.string().min(1),
        description: z.string().min(1),
        acceptanceCriteria: criteriaInputSchema.optional(),
        type: taskTypeSchema.optional(),
        risk: riskSchema.optional(),
        requiresPlan: z.boolean().optional(),
        blockedBy: z.array(z.string()).optional().describe("Ids of subtasks that must be complete first"),
        author: authorSchema,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() => {
        const child = createSubtask(input.taskId, {
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptanceCriteria,
          type: input.type,
          risk: input.risk,
          requiresPlan: input.requiresPlan,
          blockedBy: input.blockedBy,
          author: input.author,
          ...auth(input),
        });
        return { success: true, subtask: { id: child.id, title: child.title, status: child.status, held: child.held } };
      }),
  );

  server.registerTool(
    "submit_refinement",
    {
      title: "Submit refinement",
      description:
        "With the `refine` role, on a task you claimed in `refining`: make the draft ready (testable criteria, type, risk, non-goals, whether it needs a plan). It moves on to planning or coding; a blocking question sends it to a person.",
      inputSchema: {
        taskId: taskIdSchema,
        ...submitRefinementFields,
        claimToken: claimTokenSchema,
        agentId: agentIdSchema,
      },
    },
    (input) =>
      run(() =>
        submitResponse(
          submitRefinement(input.taskId, {
            description: input.description,
            acceptanceCriteria: input.acceptanceCriteria,
            type: input.type,
            risk: input.risk,
            nonGoals: input.nonGoals,
            requiresPlan: input.requiresPlan,
            openQuestions: input.openQuestions,
            message: input.message,
            author: input.author,
            context: input.context,
            decisions: input.decisions,
            risks: input.risks,
            next: input.next,
            ...auth(input),
          }),
        ),
      ),
  );

  server.registerTool(
    "heartbeat",
    {
      title: "Heartbeat",
      description:
        "Keep your claim on a task alive during long work. Claims made by hand-opened sessions expire after the project's lease (90 min by default) without any AgentQ call; every AgentQ call from your session already counts, so call this only during long silent stretches.",
      inputSchema: { taskId: taskIdSchema, claimToken: claimTokenSchema },
    },
    (input) =>
      run(() => {
        const token = auth(input).claimToken;
        const task = getTaskById(input.taskId);
        if (!task) throw new WorkflowError("Task not found.");
        const extended = !!token && touchLease(input.taskId, token);
        return { success: true, taskId: input.taskId, leaseExpiresAt: getTaskById(input.taskId)!.leaseExpiresAt, extended };
      }),
  );

  const prInputSchema = {
    taskId: taskIdSchema,
    ...submitPrFields,
    claimToken: claimTokenSchema,
    agentId: agentIdSchema,
  };
  const recordPr = (input: z.infer<z.ZodObject<typeof prInputSchema>>) =>
    run(() =>
      submitResponse(
        submitPr(input.taskId, {
          prUrl: input.prUrl,
          prNumber: input.prNumber,
          branch: input.mergeBranch,
          headBranch: input.headBranch,
          commit: input.commit,
          authors: input.authors,
          message: input.message,
          worktree: input.worktree,
          author: input.author,
          context: input.context,
          decisions: input.decisions,
          risks: input.risks,
          next: input.next,
          ...auth(input),
        }),
      ),
    );

  server.registerTool(
    "submit_pr",
    {
      title: "Submit pull request",
      description:
        "Record the pull request you opened for a task you claimed in `merging` status (use get_task_brief's `pr.body` as its body). Moves it to `pr_open` and releases it: the task completes when the PR is merged on GitHub. Never merge it yourself.",
      inputSchema: prInputSchema,
    },
    recordPr,
  );

  server.registerTool(
    "submit_merge",
    {
      title: "Submit merge (deprecated)",
      description:
        "Deprecated alias of submit_pr for older skills: records the pull request (its URL taken from prUrl or the message) and moves the task to `pr_open`.",
      inputSchema: prInputSchema,
    },
    recordPr,
  );

  server.registerTool(
    "report_blocker",
    {
      title: "Report blocker",
      description:
        "Stop working on a task you claimed because something outside your control blocks it (push rejected, missing credentials, contradictory or ambiguous requirements). Moves the task to `needs_human` with your question and releases it: no agent retries it until a person answers.",
      inputSchema: {
        taskId: taskIdSchema,
        ...reportBlockerFields,
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
      description:
        "Fetch a task by ID, including its project, conversation, history, contexts and review findings. While you hold the task for a plan critique, verification or review, it returns your independent brief instead: those checks never see the author's context.",
      inputSchema: { taskId: taskIdSchema },
      annotations: { readOnlyHint: true },
    },
    (input) =>
      run(() => {
        const task = getTaskById(input.taskId);
        if (!task) {
          throw new WorkflowError("Task not found.");
        }
        const phase = checkingPhase(task);
        if (phase) {
          const brief = buildIndependentBrief(task, phase)!;
          return { success: true, independent: true, task: independentTask(task, brief), brief, message: brief.isolation };
        }
        return { success: true, task: taskDetails(task) };
      }),
  );

  server.registerTool(
    "get_task_brief",
    {
      title: "Get task brief",
      description:
        "What you need to continue a task without rereading its whole conversation: the approved plan and validation, criteria with status, open findings, the latest handoff of each phase, the project's commands and guardrails, the round, and what people said since the last submission. For a plan critique, verification or review it is the independent brief: the task, what to check and the findings to verify, without the author's handoffs, messages or evidence.",
      inputSchema: { taskId: taskIdSchema },
      annotations: { readOnlyHint: true },
    },
    (input) =>
      run(() => {
        const brief = buildAgentBrief(input.taskId);
        if (!brief) throw new WorkflowError("Task not found.");
        return { success: true, brief };
      }),
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get skill",
      description:
        "The current text of an AgentQ skill (e.g. agentq-code) as this server ships it, with its version. Use it when your installed copy is missing or older.",
      inputSchema: { name: z.string().min(1).describe("Skill name, e.g. agentq-review") },
      annotations: { readOnlyHint: true },
    },
    (input) =>
      run(() => {
        const skill = readSkill(input.name);
        if (!skill) throw new WorkflowError(`Unknown skill ${input.name}. Skills: ${listSkills().join(", ")}.`);
        return { success: true, ...skill };
      }),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List tasks, highest priority first, as summaries (id, title, status, priority, type, risk, project, branches, pull request, dates; get_task has the rest). Archived and deleted tasks are left out. Use it to find work outside the claim loop, e.g. the `complete` tasks to archive.",
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
        return { success: true, tasks: tasks.map(taskSummary) };
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
        acceptanceCriteria: criteriaInputSchema
          .optional()
          .describe(
            "Conditions that must hold for the task to be done: strings, or { text, verify: { kind: command|test|manual|review, command? } }",
          ),
        type: taskTypeSchema.optional().describe("feature, bug, refactor, docs or chore (default feature)"),
        nonGoals: z.array(z.string()).optional().describe("What the task deliberately does not do"),
        draft: z.boolean().optional().describe("Create a rough draft an agent with the `refine` role makes ready"),
        references: z.array(referenceSchema).optional().describe("Files, issues and links to look at first"),
        risk: riskSchema.optional().describe("low, medium or high (default from the type)"),
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
            acceptanceCriteria: input.acceptanceCriteria,
            type: input.type,
            risk: input.risk,
            nonGoals: cleanList(input.nonGoals),
            draft: input.draft,
            references: input.references,
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
        "Append a comment to a task's conversation thread without changing its status (progress notes, questions for the reviewer, blockers). Returns the entry it added.",
      inputSchema: {
        taskId: taskIdSchema,
        message: z.string().min(1).describe("Comment body (markdown)"),
        author: authorSchema,
      },
    },
    (input) =>
      run(() => {
        const task = postComment(input.taskId, { message: input.message, author: input.author });
        const entry = task.conversation[task.conversation.length - 1];
        return { success: true, taskId: task.id, entry: { author: entry.authorName, timestamp: entry.timestamp, message: entry.message } };
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
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(visibleTask(task)) },
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

  server.registerResource(
    "skill",
    new ResourceTemplate("agentq://skills/{name}", {
      list: () => ({
        resources: listSkills().map((name) => ({ uri: `agentq://skills/${name}`, name, mimeType: "text/markdown" })),
      }),
    }),
    {
      title: "AgentQ skill",
      description: "An AgentQ skill as this server ships it (markdown, without frontmatter)",
      mimeType: "text/markdown",
    },
    (uri, { name }) => {
      const skill = readSkill(String(name));
      if (!skill) throw new Error(`Unknown skill ${String(name)}.`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: skill.body }] };
    },
  );

  // The skills as prompts too, for clients that let the user pick one (e.g. a slash command).
  for (const name of listSkills()) {
    const skill = readSkill(name);
    if (!skill) continue;
    server.registerPrompt(
      name,
      { title: name, description: `AgentQ skill ${name} (v${skill.version ?? "?"})` },
      () => ({ messages: [{ role: "user", content: { type: "text", text: skill.body } }] }),
    );
  }

  return server;
}
