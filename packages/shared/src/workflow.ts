import { randomUUID } from "crypto";
import {
  addActivityEvent,
  appendJson,
  createAgent,
  createTask,
  getClaimableTasks,
  getProjectById,
  getTaskById,
  patchTask,
  tryAssignTask,
  updateProject,
  withTransaction,
  type TaskPatch,
} from "./database.js";
import {
  ALL_STATUSES,
  CLAIM_RULES,
  CLAIMABLE_FROM,
  COMPOUND_ROLES,
  REVERT_FALLBACK,
  STATUS_INFO,
  UNBLOCK_TARGET,
  baseRolesOf,
  canTransition,
  resolveTargets,
  statusLabel,
} from "./catalog.js";
import { detectDefaultBranch } from "./git.js";
import type { AgentReference, Agent, Blocker, ConversationEntry, Task } from "./types.js";
import { TaskStatus } from "./types.js";

export { COMPOUND_ROLES, REVERT_FALLBACK };

/** Base role → statuses it claims (derived from CLAIM_RULES). */
export const ROLE_STATUSES: Record<string, TaskStatus[]> = CLAIM_RULES.reduce(
  (acc, rule) => {
    acc[rule.role] = [...(acc[rule.role] ?? []), ...rule.from];
    return acc;
  },
  {} as Record<string, TaskStatus[]>,
);

/** Statuses a person can no longer cancel. */
export const CANCELED_CANT_CANCEL = new Set(ALL_STATUSES.filter((s) => !STATUS_INFO[s].cancelable));

export function getClaimableStatuses(role: string): TaskStatus[] {
  return [...new Set(baseRolesOf(role).flatMap((base) => ROLE_STATUSES[base] ?? []))];
}

export function getClaimTransition(status: TaskStatus, role: string): TaskStatus | null {
  for (const base of baseRolesOf(role)) {
    const rule = CLAIM_RULES.find((r) => r.role === base && r.from.includes(status));
    if (rule) return rule.to;
  }
  return null;
}

/** The base role a (possibly compound) role acts as for a task in `status`. */
export function getEffectiveRole(status: TaskStatus, role: string): string {
  if (!COMPOUND_ROLES[role]) return role;
  const base = COMPOUND_ROLES[role].find((r) =>
    CLAIM_RULES.some((rule) => rule.role === r && rule.from.includes(status)),
  );
  return base ?? role;
}

export function normalizeStatusInput(status: string): TaskStatus | null {
  if (status === "ready for code") return TaskStatus.ReadyForCode;
  const found = Object.values(TaskStatus).find((s) => s === status);
  return found ?? null;
}

export function buildAgentRef(toolName: string, model: string): AgentReference {
  return { name: toolName, tool: toolName, model };
}

// ─── Errors ───────────────────────────────────────────────────────────

/** Thrown when an action is not allowed in the task's current state. */
export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

// ─── Low-level writers ────────────────────────────────────────────────

type MessageType = NonNullable<ConversationEntry["messageType"]>;

export function addConversation(
  task: Task,
  authorName: string,
  message: string,
  messageType?: MessageType,
): Task {
  appendJson(task.id, "conversation", {
    authorName,
    timestamp: new Date().toISOString(),
    message,
    messageType: messageType ?? "agent",
  });
  return getTaskById(task.id)!;
}

export function addActivity(taskId: string, eventType: string, actor: string, details?: string) {
  addActivityEvent({ eventType, taskId, actor, details });
}

export function appendContext(task: Task, context?: string): Task {
  const entry = context?.trim();
  if (!entry) return task;
  appendJson(task.id, "contexts", entry);
  return getTaskById(task.id)!;
}

export interface TransitionOptions {
  /** Who made the change, recorded in history: "user", an agent id, "runner", "system". */
  actor: string;
  /** Conversation entry written with the change. */
  message?: string;
  /** Author of the conversation entry and activity event (default: actor). */
  author?: string;
  messageType?: MessageType;
  /** Activity event written with the change. */
  event?: string;
  details?: string;
  /** Other columns to set in the same write. */
  patch?: TaskPatch;
  /** Drop the claim (agent and claim token). */
  release?: boolean;
  /** Handoff notes appended to task.contexts. */
  context?: string;
}

/**
 * The only way a task changes status: checks the edge against the state
 * machine, then writes history (with the actor), the status and any patch,
 * the conversation entry, the handoff context and the activity event.
 */
export function transitionTask(task: Task, to: TaskStatus, opts: TransitionOptions): Task {
  if (!canTransition(task.status, to)) {
    throw new WorkflowError(
      `A task cannot move from ${statusLabel(task.status)} to ${statusLabel(to)}.`,
    );
  }
  const now = new Date().toISOString();
  appendJson(task.id, "history", {
    pre_status: task.status,
    new_status: to,
    timestamp: now,
    actor: opts.actor,
  });
  const patch: TaskPatch = { ...opts.patch, status: to };
  if (opts.release) {
    patch.assignedAgent = null;
    patch.claimToken = null;
  }
  patchTask(task.id, patch);
  const author = opts.author ?? opts.actor;
  if (opts.message) {
    appendJson(task.id, "conversation", {
      authorName: author,
      timestamp: now,
      message: opts.message,
      messageType: opts.messageType ?? "agent",
    });
  }
  const context = opts.context?.trim();
  if (context) appendJson(task.id, "contexts", context);
  if (opts.event) addActivityEvent({ eventType: opts.event, taskId: task.id, actor: author, details: opts.details });
  return getTaskById(task.id)!;
}

function requireTask(taskId: string): Task {
  const task = getTaskById(taskId);
  if (!task) throw new WorkflowError("Task not found.");
  return task;
}

// ─── Claims ───────────────────────────────────────────────────────────

export const MAX_CLAIM_ATTEMPTS = 10;

export interface ClaimNextTaskInput {
  role: string;
  agent: {
    toolName: string;
    version: string;
    model: string;
    sessionId: string;
    host?: string;
  };
  context?: string;
  projectId?: string;
  /** Tasks to skip (e.g. a runner backing off after a failed attempt). */
  excludeTaskIds?: string[];
  /** Set when a runner claims: its id is the stable identity of the claim. */
  runnerId?: string;
}

export interface ClaimNextTaskResult {
  task: Task;
  agent: Agent;
  effectiveRole: string;
  /** Secret the claim holder presents on every submit for this task. */
  claimToken: string;
}

export function claimNextTask(input: ClaimNextTaskInput): ClaimNextTaskResult | null {
  const claimableStatuses = getClaimableStatuses(input.role);
  if (claimableStatuses.length === 0) {
    throw new Error(`Invalid role: ${input.role}`);
  }

  return withTransaction(() => {
    const candidates = getClaimableTasks(
      claimableStatuses,
      input.projectId,
      MAX_CLAIM_ATTEMPTS,
      input.excludeTaskIds ?? [],
    );
    for (const candidate of candidates) {
      const effectiveRole = getEffectiveRole(candidate.status, input.role);
      const newStatus = getClaimTransition(candidate.status, effectiveRole);
      if (!newStatus) continue;

      const claimToken = randomUUID();
      const agentId = agentIdFor(input.agent);
      const assignedAgent: AgentReference = {
        ...buildAgentRef(input.agent.toolName, input.agent.model),
        agentId,
        sessionKey: input.runnerId ? `runner:${input.runnerId}` : `session:${input.agent.sessionId}`,
        ...(input.runnerId ? { runnerId: input.runnerId } : {}),
        claimedAt: new Date().toISOString(),
      };
      const assigned = tryAssignTask({
        id: candidate.id,
        fromStatus: candidate.status,
        toStatus: newStatus,
        assignedAgent,
        claimToken,
      });
      if (!assigned) continue;

      const agent = createAgent({ ...input.agent, role: effectiveRole });
      const now = new Date().toISOString();
      appendJson(candidate.id, "history", {
        pre_status: candidate.status,
        new_status: newStatus,
        timestamp: now,
        actor: agent.id,
      });
      // archive.ts parses this exact text to rebuild agent sessions.
      appendJson(candidate.id, "conversation", {
        authorName: agent.id,
        timestamp: now,
        message: `Claimed task. Transitioning to ${newStatus}.`,
        messageType: "agent",
      });
      const context = input.context?.trim();
      if (context) appendJson(candidate.id, "contexts", context);

      return { task: getTaskById(candidate.id)!, agent, effectiveRole, claimToken };
    }
    return null;
  });
}

/** Mirrors createAgent's id so the claim can record it before the agent row exists. */
function agentIdFor(agent: ClaimNextTaskInput["agent"]): string {
  return `${agent.toolName.toLowerCase().replace(/\s+/g, "-")}@${agent.version}|${agent.model}`;
}

export function releaseTask(taskId: string, patch?: Omit<TaskPatch, "assignedAgent">): Task | null {
  if (!getTaskById(taskId)) return null;
  return patchTask(taskId, { ...patch, assignedAgent: null, claimToken: null });
}

/** Proof of claim a submit may carry. */
export interface ClaimAuth {
  claimToken?: string;
  agentId?: string;
}

/**
 * Loads a task an agent is submitting for: it must be in `status` and, when the
 * claim has a token, the caller must present it (a stale agent — one whose
 * task was unblocked and claimed again — cannot overwrite the new claim).
 */
export function requireClaim(taskId: string, status: TaskStatus | TaskStatus[], auth: ClaimAuth = {}): Task {
  const task = requireTask(taskId);
  const allowed = Array.isArray(status) ? status : [status];
  if (task.status === TaskStatus.Canceled && !allowed.includes(TaskStatus.Canceled)) {
    throw new WorkflowError("Task is canceled and cannot accept submissions.");
  }
  if (!allowed.includes(task.status)) {
    const names = allowed.map((s) => statusLabel(s)).join(" or ");
    throw new WorkflowError(`Task must be in ${names} status.`);
  }
  if (task.claimToken && auth.claimToken !== task.claimToken) {
    throw new WorkflowError(
      auth.claimToken
        ? "This task is claimed by another agent session; your claim is no longer valid."
        : "Missing claimToken: pass the claimToken returned by claim_task (runner jobs get it in their prompt).",
    );
  }
  if (auth.agentId && task.assignedAgent?.agentId && auth.agentId !== task.assignedAgent.agentId) {
    throw new WorkflowError(`This task is assigned to ${task.assignedAgent.agentId}, not ${auth.agentId}.`);
  }
  return task;
}

// ─── Reverts and blockers ─────────────────────────────────────────────

/** Consecutive runs without a submit after which a task stops retrying and asks a person. */
export function maxReverts(): number {
  const n = Number(process.env.AGENTQ_MAX_REVERTS ?? "3");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

/**
 * Releases a task whose agent went away without submitting (e.g. the runner's
 * child process exited). The task returns to the status it was claimed from
 * (the last history entry's pre_status when it is a valid origin, otherwise a
 * per-status fallback). After `maxReverts()` consecutive runs without a submit
 * it goes to `needs_human` instead, so a broken task cannot loop forever.
 * Returns null when the task is not in an active status any more, i.e. the
 * agent already submitted or the user intervened.
 */
export function revertClaim(taskId: string, reason: string): Task | null {
  return withTransaction(() => {
    const task = getTaskById(taskId);
    if (!task) return null;
    const fallback = REVERT_FALLBACK[task.status];
    if (!fallback) return null;

    const streak = task.revertStreak + 1;
    if (streak >= maxReverts()) {
      const blocker: Blocker = {
        reason: `The agent ended ${streak} times in a row without submitting. Last time: ${reason}`,
        question: "Check the output above, fix the cause (tool setup, task description, repository state), then choose where the task goes next.",
        phase: STATUS_INFO[task.status].phase,
        fromStatus: task.status,
        raisedBy: "runner",
        at: new Date().toISOString(),
      };
      const blocked = transitionTask(task, TaskStatus.NeedsHuman, {
        actor: "runner",
        author: "system",
        message: reason,
        messageType: "system",
        release: true,
        patch: { blocker, revertStreak: streak },
      });
      addActivity(taskId, "task_blocked", "runner", blocker.reason);
      return blocked;
    }

    const last = task.history[task.history.length - 1];
    const valid = CLAIMABLE_FROM[task.status] ?? [];
    const target =
      last && last.new_status === task.status && valid.includes(last.pre_status as TaskStatus)
        ? (last.pre_status as TaskStatus)
        : fallback;

    const reverted = transitionTask(task, target, {
      actor: "runner",
      author: "system",
      message: reason,
      messageType: "system",
      release: true,
      patch: { revertStreak: streak },
    });
    addActivity(taskId, "task_reverted", "runner", reason);
    return reverted;
  });
}

export interface ReportBlockerInput extends ClaimAuth {
  reason: string;
  question: string;
  author?: string;
  context?: string;
}

/**
 * The claim holder cannot finish its phase (push rejected, missing credentials,
 * ambiguous task…): the task goes to `needs_human` with the question, and the
 * claim is released so no runner retries it.
 */
export function reportBlocker(taskId: string, input: ReportBlockerInput): SubmitResult {
  return withTransaction(() => {
    const active = ALL_STATUSES.filter((s) => STATUS_INFO[s].kind === "active");
    const task = requireClaim(taskId, active, input);
    const raisedBy = input.author ?? task.assignedAgent?.agentId ?? "agent";
    const blocker: Blocker = {
      reason: input.reason.trim(),
      question: input.question.trim(),
      phase: STATUS_INFO[task.status].phase,
      fromStatus: task.status,
      raisedBy,
      at: new Date().toISOString(),
    };
    const updated = transitionTask(task, TaskStatus.NeedsHuman, {
      actor: task.assignedAgent?.agentId ?? raisedBy,
      author: raisedBy,
      message: `**Blocked:** ${blocker.reason}\n\n**Question:** ${blocker.question}`,
      messageType: "agent",
      event: "task_blocked",
      details: blocker.reason,
      release: true,
      context: input.context,
      patch: { blocker, revertStreak: 0 },
    });
    return {
      task: updated,
      previousStatus: task.status,
      newStatus: updated.status,
      message: "Blocker reported. Task moved to Needs human; a person will answer.",
    };
  });
}

export interface ResolveBlockerInput {
  answer: string;
  targetStatus: TaskStatus;
  actor?: string;
}

/** A person answers a blocked task and sends it on (the answer stays in the conversation). */
export function resolveBlocker(taskId: string, input: ResolveBlockerInput): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.NeedsHuman) {
      throw new WorkflowError("Only a task in Needs human can be resolved.");
    }
    const allowed = resolveTargets(task.blocker?.phase ?? null);
    if (!allowed.includes(input.targetStatus)) {
      throw new WorkflowError(
        `A blocker in this phase can be resolved to: ${allowed.map(statusLabel).join(", ")}.`,
      );
    }
    const actor = input.actor ?? "user";
    const answer = input.answer.trim();
    return transitionTask(task, input.targetStatus, {
      actor,
      message: answer
        ? `**Blocker resolved** → ${statusLabel(input.targetStatus)}\n\n${answer}`
        : `Blocker resolved → ${statusLabel(input.targetStatus)}.`,
      messageType: "user",
      event: "blocker_resolved",
      details: answer || undefined,
      patch: { blocker: null, revertStreak: 0 },
    });
  });
}

// ─── Human actions ────────────────────────────────────────────────────

export interface HumanActionInput {
  message?: string;
  actor?: string;
}

function humanTransition(
  taskId: string,
  from: TaskStatus,
  to: TaskStatus,
  event: string,
  message: string,
  input: HumanActionInput = {},
  details?: string,
): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== from) {
      throw new WorkflowError(`task must be in ${statusLabel(from)} status`);
    }
    return transitionTask(task, to, {
      actor: input.actor ?? "user",
      message,
      messageType: "user",
      event,
      details,
      patch: { revertStreak: 0 },
    });
  });
}

export function approvePlan(taskId: string, input: HumanActionInput = {}): Task {
  return humanTransition(taskId, TaskStatus.WaitingPlanReview, TaskStatus.ReadyForCode, "plan_approved", input.message?.trim() || "Plan approved.", input);
}

export function requestPlanChanges(taskId: string, input: HumanActionInput = {}): Task {
  const message = input.message?.trim();
  return humanTransition(taskId, TaskStatus.WaitingPlanReview, TaskStatus.PlanChangesRequested, "plan_changes_requested", message || "Plan changes requested.", input, message);
}

export function approveCode(taskId: string, input: HumanActionInput = {}): Task {
  return humanTransition(taskId, TaskStatus.WaitingCodeReview, TaskStatus.Approved, "code_approved", input.message?.trim() || "Code approved.", input);
}

export function requestCodeChanges(taskId: string, input: HumanActionInput = {}): Task {
  const message = input.message?.trim();
  return humanTransition(taskId, TaskStatus.WaitingCodeReview, TaskStatus.ChangesRequested, "code_changes_requested", message || "Code changes requested.", input, message);
}

export function requestAiReview(taskId: string, input: HumanActionInput = {}): Task {
  return humanTransition(taskId, TaskStatus.WaitingCodeReview, TaskStatus.CodeReviewRequested, "ai_review_requested", "AI code review requested.", input);
}

export function completeTask(taskId: string, input: HumanActionInput = {}): Task {
  return humanTransition(taskId, TaskStatus.Merged, TaskStatus.Complete, "task_completed", "Task completed.", input);
}

export function cancelTask(taskId: string, input: HumanActionInput = {}): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (!STATUS_INFO[task.status].cancelable) {
      throw new WorkflowError("task cannot be canceled in its current status");
    }
    return transitionTask(task, TaskStatus.Canceled, {
      actor: input.actor ?? "user",
      message: input.message?.trim() || "Task canceled.",
      messageType: "user",
      event: "task_canceled",
      release: true,
      patch: { blocker: null },
    });
  });
}

/** A person takes an active task away from its agent and puts it back in the queue. */
export function unblockTask(taskId: string, input: HumanActionInput = {}): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    const target = UNBLOCK_TARGET[task.status];
    if (!target) {
      throw new WorkflowError("task cannot be unblocked in its current status");
    }
    return transitionTask(task, target, {
      actor: input.actor ?? "user",
      message: `Task unblocked. Reverted to ${target}.`,
      messageType: "user",
      event: "task_unblocked",
      details: `Reverted to ${target}`,
      release: true,
      patch: { revertStreak: 0 },
    });
  });
}

export function addUserComment(taskId: string, input: { message: string; author?: string }): Task {
  const task = requireTask(taskId);
  const author = input.author ?? "user";
  const updated = addConversation(task, author, input.message, "user");
  addActivity(task.id, "comment_added", author, input.message);
  return updated;
}

// ─── Task creation ────────────────────────────────────────────────────

export type CreateTaskForProjectInput = Omit<Parameters<typeof createTask>[0], "mergeBranch"> & {
  mergeBranch?: string | null;
};

/**
 * Creates a task (MCP and HTTP share this). Without an explicit merge branch it
 * uses the project's default, detecting and saving it on first use.
 */
export function createTaskForProject(input: CreateTaskForProjectInput, actor = "user"): Task {
  const project = getProjectById(input.projectId);
  if (!project) throw new WorkflowError("Project not found.");
  let mergeBranch = input.mergeBranch?.trim() || project.defaultMergeBranch || null;
  if (!mergeBranch) {
    mergeBranch = detectDefaultBranch(project.workingDirectory);
    updateProject(project.id, { defaultMergeBranch: mergeBranch });
  }
  const task = createTask({ ...input, mergeBranch });
  addActivity(task.id, "task_created", actor);
  return task;
}

// ─── Agent submissions ────────────────────────────────────────────────

export interface SubmitInput extends ClaimAuth {
  message?: string;
  author?: string;
  context?: string;
}

export interface SubmitCodeInput extends SubmitInput {
  worktree?: string;
}

export interface SubmitMergeInput extends SubmitInput {
  branch: string;
  commit: string;
  authors: string;
  worktree?: string;
}

export interface SubmitResult {
  task: Task;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
  message: string;
}

interface SubmitSpec {
  from: TaskStatus;
  to: TaskStatus;
  messageType: MessageType;
  event: string;
  done: string;
}

function submit(taskId: string, spec: SubmitSpec, input: SubmitInput, message: string | undefined, patch: TaskPatch = {}, details?: string): SubmitResult {
  return withTransaction(() => {
    const task = requireClaim(taskId, spec.from, input);
    const author = input.author ?? "agent";
    const updated = transitionTask(task, spec.to, {
      actor: task.assignedAgent?.agentId ?? author,
      author,
      message,
      messageType: spec.messageType,
      event: spec.event,
      details,
      release: true,
      context: input.context,
      patch: { ...patch, revertStreak: 0 },
    });
    return { task: updated, previousStatus: task.status, newStatus: updated.status, message: spec.done };
  });
}

export function submitPlan(taskId: string, input: SubmitInput = {}): SubmitResult {
  return submit(
    taskId,
    {
      from: TaskStatus.Planning,
      to: TaskStatus.WaitingPlanReview,
      messageType: "plan",
      event: "plan_submitted",
      done: "Plan submitted. Task moved to Waiting Plan Review.",
    },
    input,
    input.message,
  );
}

export function submitCode(taskId: string, input: SubmitCodeInput = {}): SubmitResult {
  return submit(
    taskId,
    {
      from: TaskStatus.Coding,
      to: TaskStatus.WaitingCodeReview,
      messageType: "code",
      event: "code_submitted",
      done: "Code submitted. Task moved to Waiting Code Review.",
    },
    input,
    input.message,
    { worktreePath: input.worktree ?? null },
  );
}

export function submitReview(taskId: string, input: SubmitInput = {}): SubmitResult {
  return submit(
    taskId,
    {
      from: TaskStatus.Reviewing,
      to: TaskStatus.WaitingCodeReview,
      messageType: "review",
      event: "review_submitted",
      done: "Review submitted. Task moved to Waiting Code Review.",
    },
    input,
    input.message,
  );
}

export function submitMerge(taskId: string, input: SubmitMergeInput): SubmitResult {
  // archive.ts parses this format (Branch/Commit/Authors/Worktree/Message).
  const mergeDetails = [
    `Branch: ${input.branch}`,
    `Commit: ${input.commit}`,
    `Authors: ${input.authors}`,
    input.worktree ? `Worktree: ${input.worktree}` : null,
    input.message ? `Message: ${input.message}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return submit(
    taskId,
    {
      from: TaskStatus.Merging,
      to: TaskStatus.Merged,
      messageType: "merge",
      event: "merge_submitted",
      done: "Merge submitted. Task moved to Merged.",
    },
    input,
    `Merge submitted. ${mergeDetails}`,
    {},
    mergeDetails,
  );
}

export function postComment(taskId: string, input: { message: string; author?: string }): Task {
  const task = requireTask(taskId);
  const author = input.author ?? "agent";
  const updated = addConversation(task, author, input.message, "agent");
  addActivity(task.id, "comment_added", author, input.message);
  return updated;
}
