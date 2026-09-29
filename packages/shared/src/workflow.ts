import { randomUUID } from "crypto";
import {
  addActivityEvent,
  appendJson,
  createAgent,
  createTask,
  getAppState,
  getClaimableTasks,
  getDbHandle,
  getDependents,
  getSubtasks,
  getProjectById,
  getTaskById,
  patchTask,
  touchTask,
  tryAssignTask,
  updateProject,
  withTransaction,
  type TaskPatch,
} from "./database.js";
import {
  afterCode,
  afterPlan,
  afterPlanReview,
  afterReview,
  afterVerify,
  resolvePolicy,
  type GatePolicy,
} from "./policy.js";
import {
  addEvidence,
  addFindings,
  addHandoff,
  getFinding,
  getOpenFindings,
  updateFinding,
  type NewEvidence,
  type NewFinding,
} from "./records.js";
import { normalizeCriteria, type CriterionInput } from "./criteria.js";
import { matchesAny, profileCommands, resolveProfile } from "./profile.js";
import { checkDefinitionOfReady, type ReadinessInput } from "./dor.js";

/** A pull request URL on GitHub, GitLab or Bitbucket. */
const PR_URL_RE = /https?:\/\/[^\s<>()[\]"'`]+?\/(?:pull|pulls|merge_requests|pull-requests)\/\d+/;
import {
  ALL_STATUSES,
  BLOCKING_SEVERITIES,
  CLAIM_RULES,
  CLAIMABLE_FROM,
  REQUIRES_PLAN_EDITABLE,
  REVERT_FALLBACK,
  STATUS_INFO,
  TASK_TYPES,
  UNBLOCK_TARGET,
  canTransition,
  claimRuleFor,
  criteriaEditable,
  isRole,
  resolveTargets,
  statusLabel,
  maxRisk,
  type CriterionStatus,
  type Phase,
  type Risk,
  type Role,
  type Verdict,
} from "./catalog.js";
import { detectDefaultBranch } from "./git.js";
import type {
  AgentReference,
  Agent,
  ApprovedPlan,
  PlanSubmission,
  PullRequest,
  Blocker,
  ConversationEntry,
  DiffStats,
  Producer,
  Task,
  ValidationPlan,
  Verification,
} from "./types.js";
import { TaskStatus } from "./types.js";

export { REVERT_FALLBACK };

/** Role → statuses it claims (derived from CLAIM_RULES). */
export const ROLE_STATUSES: Record<Role, TaskStatus[]> = CLAIM_RULES.reduce(
  (acc, rule) => {
    acc[rule.role] = [...(acc[rule.role] ?? []), ...rule.from];
    return acc;
  },
  {} as Record<Role, TaskStatus[]>,
);

/** Statuses a person can no longer cancel. */
export const CANCELED_CANT_CANCEL = new Set(ALL_STATUSES.filter((s) => !STATUS_INFO[s].cancelable));

/** Every status an agent with these roles may claim. */
export function getClaimableStatuses(roles: readonly Role[]): TaskStatus[] {
  return [...new Set(roles.flatMap((role) => ROLE_STATUSES[role] ?? []))];
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
    patch.leaseExpiresAt = null;
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
  if (to === TaskStatus.Canceled) {
    cancelSubtasks(task.id);
    surfaceDependents(task, "was canceled");
  }
  if (task.parentId && (to === TaskStatus.Complete || to === TaskStatus.Canceled)) completeParentIfDone(task.parentId);
  return getTaskById(task.id)!;
}

/** Canceling a task cancels its unfinished subtasks: the work they were split from is dropped. */
function cancelSubtasks(parentId: string): void {
  for (const { id } of getSubtasks(parentId)) {
    const child = getTaskById(id)!;
    if (!STATUS_INFO[child.status].cancelable) continue;
    transitionTask(child, TaskStatus.Canceled, {
      actor: "system",
      author: "system",
      message: "The parent task was canceled.",
      messageType: "system",
      event: "task_canceled",
      release: true,
      patch: { blocker: null },
    });
  }
}

/**
 * A task that will never complete (canceled or deleted) keeps the tasks that
 * start after it out of the queue for good. Each one waiting in the queue goes
 * to a person instead, who drops the dependency (resolving the blocker) or
 * cancels it. Held subtasks are left alone (a re-plan drops them), and so are
 * the subtasks of a canceled parent (they are canceled with it).
 */
function surfaceDependents(dependency: Pick<Task, "id" | "title">, what: string): void {
  for (const dependent of getDependents(dependency.id)) {
    if (dependent.held) continue;
    if (dependent.parentId && getTaskById(dependent.parentId)?.status === TaskStatus.Canceled) continue;
    blockOnDependency(dependent, `"${dependency.title}" (${dependency.id}), which ${what}`);
  }
}

/** Sends a queued task to a person because a task it starts after (`which`) will never complete. */
function blockOnDependency(dependent: Task, which: string): void {
  if (!canTransition(dependent.status, TaskStatus.NeedsHuman)) return;
  const blocker: Blocker = {
    reason: `It starts after ${which}: it will never complete.`,
    question: "Send the task on without that dependency (it is dropped when you resolve), or cancel it.",
    phase: STATUS_INFO[dependent.status].phase,
    fromStatus: dependent.status,
    raisedBy: "system",
    at: new Date().toISOString(),
  };
  transitionTask(dependent, TaskStatus.NeedsHuman, {
    actor: "system",
    author: "system",
    message: `**Blocked:** ${blocker.reason}`,
    messageType: "system",
    event: "task_blocked",
    details: blocker.reason,
    patch: { blocker },
  });
}

/** A released subtask whose dependency was canceled or deleted while it was held goes to a person. */
function blockOnDeadDependency(child: Task): void {
  const dead = child.blockedBy.find((id) => !dependencyAlive(id));
  if (!dead) return;
  const dep = getTaskById(dead);
  blockOnDependency(child, dep ? `"${dep.title}" (${dead}), which was ${dep.deletedAt ? "deleted" : "canceled"}` : `${dead}, which was deleted`);
}

/** A person deleted a task: the tasks that start after it go to a person (see surfaceDependents). */
export function dependencyDeleted(task: Task): void {
  withTransaction(() => surfaceDependents(task, "was deleted"));
}

/** Whether a dependency can still complete (it exists, is not deleted and not canceled). */
function dependencyAlive(id: string): boolean {
  const dep = getTaskById(id);
  return !!dep && !dep.deletedAt && dep.status !== TaskStatus.Canceled;
}

/**
 * A split task completes once every subtask is finished and at least one
 * completed. When every one was canceled, a person decides: re-plan it, code it
 * as one task, or cancel it.
 */
function completeParentIfDone(parentId: string): void {
  const parent = getTaskById(parentId);
  if (!parent || parent.status !== TaskStatus.Split) return;
  const children = getSubtasks(parentId);
  const finished = children.every((c) => c.status === TaskStatus.Complete || c.status === TaskStatus.Canceled);
  if (!finished) return;
  if (!children.some((c) => c.status === TaskStatus.Complete)) {
    const blocker: Blocker = {
      reason: `All ${children.length} subtasks were canceled; nothing of this task was done.`,
      question: "Send it back to planning (Plan changes requested), code it as one task (Ready for code), or cancel it.",
      phase: "plan",
      fromStatus: parent.status,
      raisedBy: "system",
      at: new Date().toISOString(),
    };
    transitionTask(parent, TaskStatus.NeedsHuman, {
      actor: "system",
      author: "system",
      message: `**Blocked:** ${blocker.reason}`,
      messageType: "system",
      event: "task_blocked",
      details: blocker.reason,
      patch: { blocker },
    });
    return;
  }
  transitionTask(parent, TaskStatus.Complete, {
    actor: "system",
    author: "system",
    message: `All ${children.length} subtasks are finished.`,
    messageType: "system",
    event: "task_completed",
  });
}

/**
 * The plan was approved (by a person or the critic): subtasks it created are
 * released and the parent waits for them; otherwise the task goes to coding.
 */
function planApprovedTarget(task: Task): TaskStatus {
  // Subtasks of an earlier plan (dropped by the re-plan) or canceled by a person stay out.
  const held = getSubtasks(task.id).filter((c) => c.held && c.status !== TaskStatus.Canceled);
  if (!held.length) return TaskStatus.ReadyForCode;
  for (const child of held) patchTask(child.id, { held: false });
  for (const child of held) blockOnDeadDependency(getTaskById(child.id)!);
  return TaskStatus.Split;
}

function requireTask(taskId: string): Task {
  const task = getTaskById(taskId);
  if (!task) throw new WorkflowError("Task not found.");
  return task;
}

/** The autonomy policy that applies to a task (its override, else its project's level). */
export function policyFor(task: Task): GatePolicy {
  return resolvePolicy(task.projectId ? getProjectById(task.projectId) : null, task);
}

/** The Definition of Ready of a task in its project, whose commands can verify it too. */
function readinessIssues(input: ReadinessInput, projectId: string | null | undefined): string[] {
  const profile = resolveProfile(projectId ? getProjectById(projectId)?.profile : null);
  return checkDefinitionOfReady({ ...input, hasProjectCommands: profileCommands(profile).length > 0 });
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

// ─── Claims ───────────────────────────────────────────────────────────

export const MAX_CLAIM_ATTEMPTS = 10;

export interface ClaimNextTaskInput {
  /** The phases the agent works; it claims the queued statuses of any of them. */
  roles: readonly Role[];
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
  /**
   * Stable identity for separation of duties, when neither a runner id nor the
   * agent's sessionId says it well (the MCP server passes its own instance id).
   */
  sessionKey?: string;
}

export interface ClaimNextTaskResult {
  task: Task;
  agent: Agent;
  /** The role the claim acts as (the one whose rule covers the task's status). */
  role: Role;
  /** Secret the claim holder presents on every submit for this task. */
  claimToken: string;
}

export function claimNextTask(input: ClaimNextTaskInput): ClaimNextTaskResult | null {
  if (input.roles.length === 0 || !input.roles.every(isRole)) {
    throw new Error(`Invalid roles: ${JSON.stringify(input.roles)}`);
  }
  const claimableStatuses = getClaimableStatuses(input.roles);

  const sessionKey =
    input.sessionKey ?? (input.runnerId ? `runner:${input.runnerId}` : `session:${input.agent.sessionId}`);
  return withTransaction(() => {
    const candidates = getClaimableTasks(
      claimableStatuses,
      input.projectId,
      MAX_CLAIM_ATTEMPTS,
      input.excludeTaskIds ?? [],
      { sessionKey, model: input.agent.model },
    );
    for (const candidate of candidates) {
      const rule = claimRuleFor(candidate.status);
      if (!rule || !input.roles.includes(rule.role)) continue;
      const newStatus = rule.to;

      const claimToken = randomUUID();
      const agentId = agentIdFor(input.agent);
      const assignedAgent: AgentReference = {
        ...buildAgentRef(input.agent.toolName, input.agent.model),
        agentId,
        sessionKey,
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

      const agent = createAgent({ ...input.agent, role: rule.role });
      const now = new Date().toISOString();
      if (newStatus === TaskStatus.Planning) {
        // A new plan cycle: subtasks proposed by the previous plan are dropped.
        for (const child of getSubtasks(candidate.id).filter((c) => c.held)) {
          transitionTask(child, TaskStatus.Canceled, {
            actor: "system",
            author: "system",
            message: "The parent task is being re-planned; this proposed subtask was dropped.",
            messageType: "system",
            event: "task_canceled",
          });
        }
      }
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
      if (context) {
        appendJson(candidate.id, "contexts", context);
        addHandoff(candidate.id, { phase: "claim", round: candidate.codeRound, agentId: agent.id, summary: context });
      }
      // A runner watches its process; a hand-opened session keeps its claim by staying active.
      if (!input.runnerId) {
        patchTask(candidate.id, { leaseExpiresAt: minutesFromNow(policyFor(candidate).leaseMin) });
      }

      return { task: getTaskById(candidate.id)!, agent, role: rule.role, claimToken };
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

/** Extends the lease of a hand-opened session's claim (any activity from the session counts). */
export function touchLease(taskId: string, claimToken: string): boolean {
  const task = getTaskById(taskId);
  if (!task || !task.leaseExpiresAt || task.claimToken !== claimToken) return false;
  patchTask(taskId, { leaseExpiresAt: minutesFromNow(policyFor(task).leaseMin) });
  return true;
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
    if (input.context?.trim()) {
      addHandoff(taskId, {
        phase: blocker.phase ?? "code",
        round: task.codeRound,
        agentId: raisedBy,
        summary: input.context,
      });
    }
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

/**
 * A person answers a blocked task and sends it on (the answer stays in the
 * conversation). Sending a plan or plan-critique blocker on to coding approves
 * the plan, as approvePlan does: it is frozen and the subtasks it created are
 * released (the task then waits in `split`). Dependencies that will never
 * complete (canceled or deleted) are dropped, so the task can be claimed again.
 */
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
    if (answer) {
      addHandoff(taskId, {
        phase: "human",
        round: task.codeRound,
        agentId: actor,
        summary: `Answer to "${task.blocker?.question ?? "the blocker"}": ${answer}`,
      });
    }
    let to = input.targetStatus;
    let approvedPlan: ApprovedPlan | undefined;
    const planBlocker = task.blocker?.phase === "plan" || task.blocker?.phase === "plan_review";
    if (planBlocker && to === TaskStatus.ReadyForCode) {
      if (task.planSubmission) approvedPlan = freezePlan(task, actor);
      to = planApprovedTarget(task);
    }
    const blockedBy = task.blockedBy.filter(dependencyAlive);
    const updated = transitionTask(task, to, {
      actor,
      message: answer ? `**Blocker resolved** → ${statusLabel(to)}\n\n${answer}` : `Blocker resolved → ${statusLabel(to)}.`,
      messageType: "user",
      event: "blocker_resolved",
      details: answer || undefined,
      // A person's answer gives the agents a fresh set of rounds.
      patch: {
        blocker: null,
        revertStreak: 0,
        roundBaseline: { plan: task.planRound, code: task.codeRound },
        // Back to planning: the verifications of the old plan no longer count.
        ...(STATUS_INFO[to].phase === "plan" ? { verifyFailures: 0 } : {}),
        ...(approvedPlan ? { approvedPlan } : {}),
        ...(blockedBy.length !== task.blockedBy.length ? { blockedBy } : {}),
      },
    });
    if (approvedPlan) addActivity(taskId, "plan_approved", actor, "Approved by resolving the blocker");
    return updated;
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
  patch: TaskPatch = {},
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
      patch: { ...patch, revertStreak: 0 },
    });
  });
}

/** The latest submitted plan and its validation plan, frozen as the approved plan. */
function freezePlan(task: Task, approvedBy: string): ApprovedPlan {
  const plan = [...task.conversation].reverse().find((e) => e.messageType === "plan");
  return {
    markdown: plan?.message ?? "",
    validation: task.validationPlan,
    approvedBy,
    at: new Date().toISOString(),
  };
}

export function approvePlan(taskId: string, input: HumanActionInput = {}): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.WaitingPlanReview) {
      throw new WorkflowError(`task must be in ${statusLabel(TaskStatus.WaitingPlanReview)} status`);
    }
    const actor = input.actor ?? "user";
    const approved = freezePlan(task, actor);
    return transitionTask(task, planApprovedTarget(task), {
      actor,
      message: input.message?.trim() || "Plan approved.",
      messageType: "user",
      event: "plan_approved",
      patch: { revertStreak: 0, approvedPlan: approved },
    });
  });
}

function humanHandoff(taskId: string, summary: string | undefined, actor = "user"): void {
  const task = getTaskById(taskId);
  if (task && summary?.trim()) addHandoff(taskId, { phase: "human", round: task.codeRound, agentId: actor, summary });
}

export function requestPlanChanges(taskId: string, input: HumanActionInput = {}): Task {
  const message = input.message?.trim();
  humanHandoff(taskId, message, input.actor);
  return humanTransition(taskId, TaskStatus.WaitingPlanReview, TaskStatus.PlanChangesRequested, "plan_changes_requested", message || "Plan changes requested.", input, message);
}

export function approveCode(taskId: string, input: HumanActionInput = {}): Task {
  return humanTransition(taskId, TaskStatus.WaitingCodeReview, TaskStatus.Approved, "code_approved", input.message?.trim() || "Code approved.", input);
}

export interface RequestCodeChangesInput extends HumanActionInput {
  /** Earlier findings the person wants fixed (reopened if they were answered). */
  findingIds?: string[];
  /** Record the message as a finding (id H<round>-<n>) the coder must answer. Default true. */
  asFinding?: boolean;
}

/**
 * A person asks for changes. The message becomes a finding the coder answers by
 * id (like a reviewer's), and chosen earlier findings are reopened.
 */
export function requestCodeChanges(taskId: string, input: RequestCodeChangesInput = {}): Task {
  const message = input.message?.trim();
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.WaitingCodeReview) {
      throw new WorkflowError(`task must be in ${statusLabel(TaskStatus.WaitingCodeReview)} status`);
    }
    const actor = input.actor ?? "user";
    for (const id of input.findingIds ?? []) {
      const finding = getFinding(taskId, id);
      if (!finding) throw new WorkflowError(`Unknown finding ${id}.`);
      if (finding.status !== "open") updateFinding(taskId, id, { status: "open", reopened: true });
    }
    if (message && input.asFinding !== false) {
      addFindings(taskId, "H", Math.max(1, task.codeRound), [{ severity: "major", text: message }], actor);
    }
    humanHandoff(taskId, message, actor);
    const reopened = input.findingIds?.length ? `\n\nReopened: ${input.findingIds.join(", ")}` : "";
    return transitionTask(task, TaskStatus.ChangesRequested, {
      actor,
      message: (message || "Code changes requested.") + reopened,
      messageType: "user",
      event: "code_changes_requested",
      details: message,
      patch: { revertStreak: 0 },
    });
  });
}

/**
 * A person reviewing the code sends the task back to planning (the plan itself
 * is wrong). The approved plan stays until the planner's next one is approved;
 * the new plan gets fresh rounds and verifications.
 */
export function requestReplan(taskId: string, input: HumanActionInput = {}): Task {
  const message = input.message?.trim();
  const task = requireTask(taskId);
  humanHandoff(taskId, message, input.actor);
  return humanTransition(
    taskId,
    TaskStatus.WaitingCodeReview,
    TaskStatus.PlanChangesRequested,
    "plan_changes_requested",
    message || "Sent back to planning.",
    input,
    message,
    { verifyFailures: 0, roundBaseline: { plan: task.planRound, code: task.codeRound } },
  );
}

export function requestAiReview(taskId: string, input: HumanActionInput = {}): Task {
  return humanTransition(taskId, TaskStatus.WaitingCodeReview, TaskStatus.CodeReviewRequested, "ai_review_requested", "AI code review requested.", input);
}

/** A person marks the PR merged (the PR sync does this on its own when `gh` can see it). */
export function completeTask(taskId: string, input: HumanActionInput = {}): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.PrOpen) {
      throw new WorkflowError(`task must be in ${statusLabel(TaskStatus.PrOpen)} status`);
    }
    return transitionTask(task, TaskStatus.Complete, {
      actor: input.actor ?? "user",
      message: input.message?.trim() || "Task completed.",
      messageType: "user",
      event: "task_completed",
      patch: task.pullRequest
        ? { pullRequest: { ...task.pullRequest, state: "merged", mergedAt: task.pullRequest.mergedAt ?? new Date().toISOString() } }
        : {},
    });
  });
}

/** The PR sync saw the PR merged on GitHub. */
export function completeFromPullRequest(taskId: string, pr: PullRequest): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.PrOpen) throw new WorkflowError("The task has no open pull request.");
    const by = pr.mergedBy ? `github:${pr.mergedBy}` : "github";
    return transitionTask(task, TaskStatus.Complete, {
      actor: by,
      author: by,
      message: `Pull request merged${pr.mergedBy ? ` by ${pr.mergedBy}` : ""}: ${pr.url ?? `#${pr.number}`}.`,
      messageType: "system",
      event: "pr_merged",
      details: pr.url ?? undefined,
      patch: { pullRequest: pr },
    });
  });
}

/** The PR was closed without merging: a person decides what happens to the task. */
export function pullRequestClosed(taskId: string, pr: PullRequest): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.PrOpen) throw new WorkflowError("The task has no open pull request.");
    const blocker: Blocker = {
      reason: `The pull request ${pr.url ?? `#${pr.number}`} was closed without merging.`,
      question: "Reopen it and send the task back to PR open, send it back to Approved for a new PR, or cancel it.",
      phase: "merge",
      fromStatus: task.status,
      raisedBy: "github",
      at: new Date().toISOString(),
    };
    return transitionTask(task, TaskStatus.NeedsHuman, {
      actor: "github",
      author: "system",
      message: blocker.reason,
      messageType: "system",
      event: "pr_closed",
      patch: { pullRequest: pr, blocker },
    });
  });
}

/** Records what the sync saw on GitHub without changing the status. */
export function recordPullRequest(taskId: string, pr: PullRequest): Task | null {
  return patchTask(taskId, { pullRequest: pr });
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

export type TaskEdit = Omit<TaskPatch, "acceptanceCriteria"> & { acceptanceCriteria?: CriterionInput[] };

/**
 * A person edits a task's fields (never its claim or history), only in the
 * statuses STATUS_INFO marks editable: never while an agent holds it. The
 * criteria are frozen with an approved plan (see criteriaEditable). Changing
 * requiresPlan before work starts routes the task (see REQUIRES_PLAN_EDITABLE).
 */
export function editTask(taskId: string, edit: TaskEdit): Task {
  return withTransaction(() => editTaskFields(taskId, edit));
}

function editTaskFields(taskId: string, edit: TaskEdit): Task {
  const task = requireTask(taskId);
  if (!STATUS_INFO[task.status].editable) {
    throw new WorkflowError(
      STATUS_INFO[task.status].kind === "active"
        ? `An agent is working on this task (${statusLabel(task.status)}): unblock it before editing it.`
        : `A task in ${statusLabel(task.status)} cannot be edited.`,
    );
  }
  const { acceptanceCriteria, ...rest } = edit;
  if (acceptanceCriteria && !criteriaEditable(task)) {
    throw new WorkflowError(
      "The acceptance criteria are frozen with the approved plan: send the task back to planning to change them.",
    );
  }
  const planChanged = rest.requiresPlan !== undefined && rest.requiresPlan !== task.requiresPlan;
  if (planChanged && !REQUIRES_PLAN_EDITABLE.includes(task.status)) {
    throw new WorkflowError(
      `Whether a task requires a plan can change only before work starts (${REQUIRES_PLAN_EDITABLE.map(statusLabel).join(", ")}).`,
    );
  }
  const patch: TaskPatch = { ...rest };
  if (acceptanceCriteria) patch.acceptanceCriteria = normalizeCriteria(acceptanceCriteria, task.acceptanceCriteria);
  const project = task.projectId ? getProjectById(task.projectId) : null;
  if (resolveProfile(project?.profile).dorMode !== "off") {
    const next = { ...task, ...patch };
    patch.dorIssues = readinessIssues({ ...next, acceptanceCriteria: next.acceptanceCriteria }, next.projectId);
  }
  const updated = patchTask(taskId, patch)!;
  const to =
    planChanged && updated.requiresPlan && task.status === TaskStatus.ReadyForCode && !task.approvedPlan
      ? TaskStatus.PlanRequested
      : planChanged && !updated.requiresPlan && task.status === TaskStatus.PlanRequested
        ? TaskStatus.ReadyForCode
        : null;
  if (!to) return updated;
  return transitionTask(updated, to, {
    actor: "user",
    message: updated.requiresPlan ? "Requires a plan now: a planner writes one first." : "No longer requires a plan: ready for code.",
    messageType: "user",
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
  const mode = resolveProfile(project.profile).dorMode;
  const issues = mode === "off" ? [] : readinessIssues(input, project.id);
  if (mode === "enforce" && issues.length && !input.draft) {
    throw new WorkflowError(`The task is not ready (this project enforces a Definition of Ready):\n- ${issues.join("\n- ")}`);
  }
  const task = createTask({ ...input, mergeBranch, dorIssues: issues });
  addActivity(task.id, "task_created", actor);
  if (issues.length) addActivity(task.id, "dor_warning", actor, issues.join("\n"));
  for (const note of input.contexts ?? []) {
    if (note.trim()) addHandoff(task.id, { phase: "human", round: 0, agentId: actor, summary: note });
  }
  return task;
}

// ─── Agent submissions ────────────────────────────────────────────────

export interface SubmitInput extends ClaimAuth {
  message?: string;
  author?: string;
  /** Handoff summary for the next phase (also appended to task.contexts). */
  context?: string;
  /** Decisions taken, and why. */
  decisions?: string[];
  /** What could go wrong or is still uncertain. */
  risks?: string[];
  /** What the next phase should do or check first. */
  next?: string[];
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
  phase: Phase;
  messageType: MessageType;
  event: string;
  /** Label of the submission, e.g. "Plan submitted". */
  done: string;
}

function producerOf(task: Task): Producer {
  const agent = task.assignedAgent;
  return {
    sessionKey: agent?.sessionKey ?? null,
    agentId: agent?.agentId ?? null,
    tool: agent?.tool ?? null,
    model: agent?.model ?? null,
    at: new Date().toISOString(),
  };
}

interface SubmitPlanOut {
  to: TaskStatus;
  message?: string;
  patch?: TaskPatch;
  details?: string;
  /** Written after the transition (e.g. why the task went to a person). */
  note?: { message: string; event?: string };
}

function submit(
  taskId: string,
  spec: SubmitSpec,
  input: SubmitInput,
  decide: (task: Task, policy: GatePolicy) => SubmitPlanOut,
): SubmitResult {
  return withTransaction(() => {
    const task = requireClaim(taskId, spec.from, input);
    const author = input.author ?? "agent";
    const out = decide(task, policyFor(task));
    const updated = transitionTask(task, out.to, {
      actor: task.assignedAgent?.agentId ?? author,
      author,
      message: out.message,
      messageType: spec.messageType,
      event: spec.event,
      details: out.details,
      release: true,
      context: input.context,
      patch: {
        ...out.patch,
        revertStreak: 0,
        producers: { ...task.producers, [spec.phase]: producerOf(task) },
      },
    });
    if (input.context?.trim()) {
      addHandoff(taskId, {
        phase: spec.phase,
        round: spec.phase === "plan" ? updated.planRound : updated.codeRound,
        agentId: task.assignedAgent?.agentId ?? author,
        summary: input.context,
        decisions: input.decisions,
        risks: input.risks,
        next: input.next,
      });
    }
    let final = updated;
    if (out.note) {
      final = addConversation(updated, "system", out.note.message, "system");
      if (out.note.event) addActivity(taskId, out.note.event, "system", out.note.message);
    }
    return {
      task: final,
      previousStatus: task.status,
      newStatus: final.status,
      message: `${spec.done}. Task moved to ${statusLabel(final.status)}.`,
    };
  });
}

export interface SubmitPlanInput extends SubmitInput {
  /** How each acceptance criterion will be verified, and the commands that must keep passing. */
  validationPlan?: ValidationPlan;
  /** Questions for a person; a blocking one sends the task to needs_human first. */
  openQuestions?: { text: string; blocking?: boolean }[];
  /** The planner's risk estimate (can only raise the task's risk). */
  suggestedRisk?: Risk;
  /** Subtask titles the plan proposes (created with create_subtask). */
  proposedSubtasks?: string[];
  /** Paths the plan expects to touch; protected ones raise the risk to high. */
  touchedPaths?: string[];
}

function checkValidationPlan(task: Task, plan: ValidationPlan): ValidationPlan {
  const ids = new Set(task.acceptanceCriteria.map((c) => c.id));
  const unknown = plan.items.map((i) => i.criterionId).filter((id) => !ids.has(id));
  if (unknown.length) {
    throw new WorkflowError(
      `validationPlan names unknown criteria: ${unknown.join(", ")}. The task's criteria are ${[...ids].join(", ") || "none"}.`,
    );
  }
  return {
    items: plan.items.map((i) => ({ ...i, how: i.how.trim(), command: i.command?.trim() || undefined })),
    regressionCommands: plan.regressionCommands.map((c) => c.trim()).filter(Boolean),
  };
}

/**
 * Where a plan is bigger than one reviewable PR (the project's maxPlanFiles and
 * maxCriteria) without splitting the work, or proposes subtasks it did not
 * create. Warnings for the critic and the person approving, never a refusal.
 */
function planSizeWarnings(task: Task, touched: string[], proposed: string[]): string[] {
  const profile = resolveProfile(task.projectId ? getProjectById(task.projectId)?.profile : null);
  const created = getSubtasks(task.id).filter((c) => c.held && c.status !== TaskStatus.Canceled).length;
  const warnings: string[] = [];
  if (!created && touched.length > profile.maxPlanFiles) {
    warnings.push(`The plan touches ${touched.length} files (the project's limit is ${profile.maxPlanFiles}) and creates no subtasks.`);
  }
  const criteria = task.acceptanceCriteria.filter((c) => c.status !== "waived").length;
  if (!created && criteria > profile.maxCriteria) {
    warnings.push(`The task has ${criteria} acceptance criteria (the project's limit is ${profile.maxCriteria}) and the plan creates no subtasks.`);
  }
  if (proposed.length && !created) {
    warnings.push(`The plan proposes ${proposed.length} subtasks but created none with create_subtask.`);
  }
  return warnings;
}

export function submitPlan(taskId: string, input: SubmitPlanInput = {}): SubmitResult {
  return submit(
    taskId,
    { from: TaskStatus.Planning, phase: "plan", messageType: "plan", event: "plan_submitted", done: "Plan submitted" },
    input,
    (task, policy) => {
      const project = task.projectId ? getProjectById(task.projectId) : null;
      const protectedPaths = resolveProfile(project?.profile).protectedPaths;
      const questions = (input.openQuestions ?? []).map((q) => ({ text: q.text.trim(), blocking: !!q.blocking })).filter((q) => q.text);
      const touched = (input.touchedPaths ?? []).map((p) => p.trim()).filter(Boolean);
      const proposed = (input.proposedSubtasks ?? []).map((x) => x.trim()).filter(Boolean);
      const sizeWarnings = planSizeWarnings(task, touched, proposed);
      const submission: PlanSubmission = {
        openQuestions: questions,
        suggestedRisk: input.suggestedRisk ?? null,
        proposedSubtasks: proposed,
        touchedPaths: touched,
        sizeWarnings,
      };
      // Risk only goes up: the planner's estimate, or protected paths the plan touches.
      const reasons: string[] = [];
      let risk = task.risk;
      if (input.suggestedRisk && maxRisk(risk, input.suggestedRisk) !== risk) {
        risk = maxRisk(risk, input.suggestedRisk);
        reasons.push(`The planner rated the plan ${input.suggestedRisk} risk`);
      }
      const hits = touched.filter((p) => matchesAny(p, protectedPaths));
      if (hits.length) {
        risk = "high";
        reasons.push(`The plan touches protected paths: ${hits.join(", ")}`);
      }
      const blocking = questions.filter((q) => q.blocking);
      const blocker: Blocker | null = blocking.length
        ? {
            reason: "The plan has questions only a person can answer.",
            question: blocking.map((q) => q.text).join("\n"),
            phase: "plan",
            fromStatus: task.status,
            raisedBy: task.assignedAgent?.agentId ?? input.author ?? "agent",
            at: new Date().toISOString(),
          }
        : null;
      return {
        to: afterPlan({ ...task, risk }, policy, { blockingQuestions: blocking.length > 0 }),
        message: input.message,
        ...(sizeWarnings.length ? { note: { message: ["**Plan size:**", ...sizeWarnings.map((w) => `- ${w}`)].join("\n") } } : {}),
        patch: {
          // A revision without a validation plan clears the previous one: approval freezes only this plan's.
          validationPlan: input.validationPlan ? checkValidationPlan(task, input.validationPlan) : null,
          planSubmission: submission,
          risk,
          riskReasons: [...task.riskReasons, ...reasons.filter((r) => !task.riskReasons.includes(r))],
          ...(blocker ? { blocker } : {}),
        },
      };
    },
  );
}

export interface SubmitPlanReviewInput extends SubmitInput {
  verdict: Verdict;
  findings?: ReviewFindingInput[];
  verifiedFindings?: { id: string; status: "verified" | "open" }[];
  /** The critic may raise the risk (never lower it). */
  suggestedRisk?: Risk;
  question?: string;
}

/** An AI critic reviews the plan: approve (low risk goes straight to coding), request changes, or ask a person. */
export function submitPlanReview(taskId: string, input: SubmitPlanReviewInput): SubmitResult {
  return submit(
    taskId,
    {
      from: TaskStatus.PlanReviewing,
      phase: "plan_review",
      messageType: "review",
      event: "plan_review_submitted",
      done: `Plan critique submitted (${input.verdict})`,
    },
    input,
    (task, policy) => {
      const critic = task.assignedAgent?.agentId ?? input.author ?? "agent";
      const round = task.planRound + 1;
      for (const check of input.verifiedFindings ?? []) {
        const finding = getFinding(taskId, check.id);
        if (!finding) throw new WorkflowError(`Unknown finding ${check.id}.`);
        if (check.status === "verified") updateFinding(taskId, check.id, { status: "verified" });
        else if (finding.status !== "open") updateFinding(taskId, check.id, { status: "open", reopened: true });
      }
      addFindings(taskId, "P", round, input.findings ?? [], critic);
      const open = getOpenFindings(taskId, "plan");
      const blocking = open.filter((f) => BLOCKING_SEVERITIES.includes(f.severity));
      if (input.verdict === "approve" && blocking.length) {
        throw new WorkflowError(
          `Cannot approve a plan with open blocker or major findings: ${blocking.map((f) => f.id).join(", ")}.`,
        );
      }
      if (input.verdict === "request_changes" && open.length === 0) {
        throw new WorkflowError("request_changes needs at least one open finding (pass findings[]).");
      }
      if (input.verdict === "needs_human" && !input.question?.trim()) {
        throw new WorkflowError("needs_human needs a question for the person who decides.");
      }
      const risk = input.suggestedRisk ? maxRisk(task.risk, input.suggestedRisk) : task.risk;
      const routing = afterPlanReview({ ...task, risk, planRound: round }, policy, input.verdict);
      const openIds = open.map((f) => `${f.id} (${f.severity})`).join(", ") || "none";
      let blocker: Blocker | null = null;
      let note: SubmitPlanOut["note"];
      if (routing.reason === "needs_human" || routing.reason === "round_limit") {
        blocker = {
          reason:
            routing.reason === "round_limit"
              ? `The critic asked for plan changes ${round - (task.roundBaseline.plan ?? 0)} times (limit ${policy.maxPlanRounds}). Open findings: ${openIds}.`
              : `The critic could not decide. Open findings: ${openIds}.`,
          question: input.question?.trim() || "Read the plan and the critique, then approve the plan or send it back.",
          phase: "plan_review",
          fromStatus: task.status,
          raisedBy: routing.reason === "round_limit" ? "system" : critic,
          at: new Date().toISOString(),
        };
      } else if (routing.reason === "risk") {
        note = { message: `The critic approved the plan; the task is ${risk} risk, so a person approves it too.` };
      }
      let to = routing.status;
      let approvedPlan: ApprovedPlan | undefined;
      if (to === TaskStatus.ReadyForCode) {
        approvedPlan = freezePlan(task, critic);
        to = planApprovedTarget(task);
      }
      return {
        to,
        message: input.message,
        details: input.verdict,
        note,
        patch: {
          planRound: round,
          risk,
          ...(approvedPlan ? { approvedPlan } : {}),
          ...(blocker ? { blocker } : {}),
        },
      };
    },
  );
}

export interface CreateSubtaskInput extends ClaimAuth {
  title: string;
  description: string;
  acceptanceCriteria?: CriterionInput[];
  type?: Task["type"];
  risk?: Risk;
  requiresPlan?: boolean;
  /** Tasks (usually earlier subtasks) that must be complete first; never the parent or a canceled task. */
  blockedBy?: string[];
  author?: string;
}

/**
 * The planner splits a task: the subtask is held until the parent's plan is
 * approved, then released; the parent waits in `split` until they all finish.
 */
export function createSubtask(parentId: string, input: CreateSubtaskInput): Task {
  return withTransaction(() => {
    const parent = requireClaim(parentId, TaskStatus.Planning, input);
    const siblings = new Set(getSubtasks(parentId).map((c) => c.id));
    // The parent (and its own parents) wait for this subtask: depending on them would deadlock.
    const ancestors = new Set<string>();
    for (let t: Task | null = parent; t && !ancestors.has(t.id); t = t.parentId ? getTaskById(t.parentId) : null) {
      ancestors.add(t.id);
    }
    for (const dep of input.blockedBy ?? []) {
      const other = getTaskById(dep);
      if (!other || other.deletedAt || (other.projectId !== parent.projectId && !siblings.has(dep))) {
        throw new WorkflowError(`blockedBy: unknown task ${dep} (use ids of this project's tasks, e.g. earlier subtasks).`);
      }
      if (ancestors.has(dep)) {
        throw new WorkflowError(
          `blockedBy: ${dep} is the task being split (or its parent): it waits for its subtasks, so this one would never start. Use ids of earlier subtasks.`,
        );
      }
      if (other.status === TaskStatus.Canceled) {
        throw new WorkflowError(`blockedBy: ${dep} is canceled and will never complete.`);
      }
    }
    const author = input.author ?? parent.assignedAgent?.agentId ?? "planner";
    const child = createTask({
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      guardrails: parent.guardrails,
      type: input.type ?? parent.type,
      risk: input.risk ? maxRisk(input.risk, parent.risk === "high" ? "medium" : "low") : undefined,
      requiresPlan: input.requiresPlan ?? false,
      mergeBranch: parent.mergeBranch,
      projectId: parent.projectId!,
      autonomy: parent.autonomy,
      parentId,
      blockedBy: input.blockedBy ?? [],
      held: true,
    });
    // Subtasks meet the project's Definition of Ready too (enforce: the insert is rolled back).
    const mode = resolveProfile(getProjectById(parent.projectId!)?.profile).dorMode;
    const issues = mode === "off" ? [] : readinessIssues(child, child.projectId);
    if (mode === "enforce" && issues.length) {
      throw new WorkflowError(`The subtask is not ready (this project enforces a Definition of Ready):\n- ${issues.join("\n- ")}`);
    }
    if (issues.length) patchTask(child.id, { dorIssues: issues });
    addActivity(child.id, "task_created", author, `Subtask of ${parentId}`);
    if (issues.length) addActivity(child.id, "dor_warning", author, issues.join("\n"));
    addActivity(parentId, "subtask_created", author, `${child.title} (${child.id})`);
    touchTask(parentId);
    return getTaskById(child.id)!;
  });
}

export interface SubmitRefinementInput extends SubmitInput {
  description?: string;
  acceptanceCriteria?: CriterionInput[];
  type?: Task["type"];
  risk?: Risk;
  nonGoals?: string[];
  requiresPlan?: boolean;
  openQuestions?: { text: string; blocking?: boolean }[];
}

/** A refiner turns a draft into a ready task (criteria, risk, scope), or asks a person. */
export function submitRefinement(taskId: string, input: SubmitRefinementInput): SubmitResult {
  return submit(
    taskId,
    { from: TaskStatus.Refining, phase: "refine", messageType: "plan", event: "draft_refined", done: "Draft refined" },
    input,
    (task) => {
      const criteria = input.acceptanceCriteria ? normalizeCriteria(input.acceptanceCriteria, task.acceptanceCriteria) : task.acceptanceCriteria;
      const next = {
        ...task,
        description: input.description?.trim() || task.description,
        acceptanceCriteria: criteria,
        type: input.type ?? task.type,
        // A draft's risk is only its type's default: the refiner sets it, never below
        // the type's default, and never lowers a risk a person marked high.
        risk: refinedRisk(task, input.type ?? task.type, input.risk),
        requiresPlan: input.requiresPlan ?? task.requiresPlan,
      };
      const mode = resolveProfile(task.projectId ? getProjectById(task.projectId)?.profile : null).dorMode;
      const issues = mode === "off" ? [] : readinessIssues(next, task.projectId);
      const blocking = (input.openQuestions ?? []).filter((q) => q.blocking && q.text.trim());
      // Under enforce the refiner fixes what is missing, or asks a person (a blocking question).
      if (mode === "enforce" && issues.length && !blocking.length) {
        throw new WorkflowError(
          `The refined task is not ready (this project enforces a Definition of Ready):\n- ${issues.join("\n- ")}\nFix these, or ask a blocking question.`,
        );
      }
      const blocker: Blocker | null = blocking.length
        ? {
            reason: "The draft has questions only a person can answer.",
            question: blocking.map((q) => q.text.trim()).join("\n"),
            phase: "refine",
            fromStatus: task.status,
            raisedBy: task.assignedAgent?.agentId ?? "refiner",
            at: new Date().toISOString(),
          }
        : null;
      return {
        to: blocker ? TaskStatus.NeedsHuman : next.requiresPlan ? TaskStatus.PlanRequested : TaskStatus.ReadyForCode,
        message: input.message,
        patch: {
          description: next.description,
          acceptanceCriteria: criteria,
          type: next.type,
          risk: next.risk,
          requiresPlan: next.requiresPlan,
          nonGoals: input.nonGoals ?? task.nonGoals,
          dorIssues: issues,
          ...(blocker ? { blocker } : {}),
        },
      };
    },
  );
}

function refinedRisk(task: Task, type: Task["type"], wanted: Risk | undefined): Risk {
  const floor = TASK_TYPES[type].defaultRisk;
  if (task.risk === "high") return "high";
  return maxRisk(wanted ?? floor, floor);
}

/** A person promotes a draft as it is (its readiness issues are kept as warnings). */
export function promoteDraft(taskId: string, input: HumanActionInput = {}): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.Draft) throw new WorkflowError("Only a draft can be promoted.");
    const to = task.requiresPlan ? TaskStatus.PlanRequested : TaskStatus.ReadyForCode;
    const mode = resolveProfile(task.projectId ? getProjectById(task.projectId)?.profile : null).dorMode;
    return transitionTask(task, to, {
      actor: input.actor ?? "user",
      message: input.message?.trim() || `Draft promoted to ${statusLabel(to)}.`,
      messageType: "user",
      event: "draft_promoted",
      patch: { dorIssues: mode === "off" ? [] : readinessIssues(task, task.projectId) },
    });
  });
}

export interface SubmitCodeInput extends SubmitInput {
  worktree?: string;
  /** Feature branch the commits are on (recorded as the task's real branch). */
  branch?: string;
  /** Head commit of the submission. */
  headSha?: string;
  /** Commands the coder ran (and manual checks), optionally tied to a criterion. */
  evidence?: NewEvidence[];
  /** The coder's view of each criterion: met, failed or still pending. */
  criteria?: { id: string; status: CriterionStatus }[];
  /** An answer for every open review finding: fixed, or wontfix with the reason. */
  findingResolutions?: { id: string; status: "fixed" | "wontfix"; resolution: string }[];
}

/** Minutes after which the verifier's heartbeat counts as gone. */
const VERIFIER_STALE_MS = 2 * 60_000;

export function verifierOnline(now = Date.now()): boolean {
  const beat = getAppState("verifier_heartbeat");
  if (!beat) return false;
  const at = new Date(beat.value).getTime();
  return now - (Number.isFinite(at) ? at : new Date(beat.updatedAt).getTime()) < VERIFIER_STALE_MS;
}

/** Whether the task has anything the verifier can run. */
export function hasVerificationCommands(task: Task): boolean {
  const profile = resolveProfile(task.projectId ? getProjectById(task.projectId)?.profile : null);
  const plan = task.approvedPlan?.validation;
  return (
    profileCommands(profile).length > 0 ||
    !!plan?.regressionCommands.length ||
    !!plan?.items.some((i) => i.command) ||
    task.acceptanceCriteria.some((c) => c.verify.command)
  );
}

export function submitCode(taskId: string, input: SubmitCodeInput = {}): SubmitResult {
  return submit(
    taskId,
    { from: TaskStatus.Coding, phase: "code", messageType: "code", event: "code_submitted", done: "Code submitted" },
    input,
    (task, policy) => {
      const author = task.assignedAgent?.agentId ?? input.author ?? "agent";
      const round = task.codeRound + 1;

      // Every open review finding needs an answer.
      const open = getOpenFindings(taskId, "code");
      const resolutions = new Map((input.findingResolutions ?? []).map((r) => [r.id, r]));
      const missing = open.filter((f) => !resolutions.has(f.id)).map((f) => f.id);
      if (missing.length) {
        throw new WorkflowError(
          `Answer every open review finding in findingResolutions (fixed, or wontfix with a reason): ${missing.join(", ")}.`,
        );
      }
      for (const r of resolutions.values()) {
        if (!getFinding(taskId, r.id)) throw new WorkflowError(`Unknown finding ${r.id}.`);
        updateFinding(taskId, r.id, { status: r.status, resolution: r.resolution.trim() });
      }

      const ids = new Set(task.acceptanceCriteria.map((c) => c.id));
      const badCriterion = [...(input.criteria ?? []).map((c) => c.id), ...(input.evidence ?? []).map((e) => e.criterionId)]
        .filter((id): id is string => !!id && !ids.has(id));
      if (badCriterion.length) throw new WorkflowError(`Unknown criteria: ${[...new Set(badCriterion)].join(", ")}.`);

      const evidence = addEvidence(taskId, round, input.evidence ?? [], author);
      const statuses = new Map((input.criteria ?? []).map((c) => [c.id, c.status]));
      const criteria = task.acceptanceCriteria.map((c) => ({
        ...c,
        status: statuses.get(c.id) ?? c.status,
        evidenceIds: [...c.evidenceIds, ...evidence.filter((e) => e.criterionId === c.id).map((e) => e.id)],
      }));

      const verifyNow = hasVerificationCommands(task) && verifierOnline();
      const verification: Verification | null = verifyNow
        ? task.verification
        : {
            round,
            passed: false,
            skipped: true,
            note: hasVerificationCommands(task)
              ? "Not verified: the AgentQ web server (which runs the verifier) is not running."
              : "Not verified: the project has no commands configured (Projects → Edit → Commands).",
            tampering: [],
            tamperStrikes: task.verification?.tamperStrikes ?? 0,
            verifiedSha: null,
            at: new Date().toISOString(),
          };

      return {
        to: afterCode(task, policy, { verify: verifyNow }),
        message: input.message,
        patch: {
          worktreePath: input.worktree ?? null,
          realBranch: input.branch?.trim() || task.realBranch,
          headSha: input.headSha?.trim() || null,
          acceptanceCriteria: criteria,
          verification,
        },
      };
    },
  );
}

export interface SubmitVerificationInput extends ClaimAuth {
  passed: boolean;
  evidence: NewEvidence[];
  /** Test tampering the verifier found (deleted tests, .skip/.only, lowered thresholds). */
  tampering?: string[];
  diffStats?: DiffStats | null;
  /** Changed files that match the project's protected paths. */
  touchedProtected?: string[];
  verifiedSha?: string | null;
  /** The verifier could not run at all (worktree missing, ...): a person looks, no retry counted. */
  infraError?: string;
  author?: string;
}

/** The verifier reports: evidence per command, criteria met/failed, and where the task goes. */
export function submitVerification(taskId: string, input: SubmitVerificationInput): SubmitResult {
  return withTransaction(() => {
    const task = requireClaim(taskId, TaskStatus.Verifying, input);
    const policy = policyFor(task);
    const actor = input.author ?? task.assignedAgent?.agentId ?? "runner:verify";
    const round = task.codeRound + 1;
    const now = new Date().toISOString();

    if (input.infraError) {
      const blocker: Blocker = {
        reason: input.infraError,
        question: "Fix the problem (e.g. restore the worktree), then send the task back to verification or to review.",
        phase: "verify",
        fromStatus: task.status,
        raisedBy: actor,
        at: now,
      };
      const blocked = transitionTask(task, TaskStatus.NeedsHuman, {
        actor,
        author: "verifier",
        message: `**Verification could not run:** ${input.infraError}`,
        messageType: "verify",
        event: "task_blocked",
        details: input.infraError,
        release: true,
        patch: { blocker },
      });
      return { task: blocked, previousStatus: task.status, newStatus: blocked.status, message: "Verification blocked." };
    }

    const evidence = addEvidence(taskId, round, input.evidence, "runner:verify");
    const results = new Map<string, boolean>();
    for (const e of evidence) {
      if (!e.criterionId || e.skipped) continue;
      results.set(e.criterionId, (results.get(e.criterionId) ?? true) && e.exitCode === 0);
    }
    const criteria = task.acceptanceCriteria.map((c) => ({
      ...c,
      status: results.has(c.id) ? ((results.get(c.id) ? "met" : "failed") as CriterionStatus) : c.status,
      evidenceIds: [...c.evidenceIds, ...evidence.filter((e) => e.criterionId === c.id).map((e) => e.id)],
    }));

    // Risk only goes up: protected paths or a diff larger than the project allows.
    const profile = resolveProfile(task.projectId ? getProjectById(task.projectId)?.profile : null);
    const reasons: string[] = [];
    if (input.touchedProtected?.length) reasons.push(`Touches protected paths: ${input.touchedProtected.join(", ")}`);
    const size = input.diffStats ? input.diffStats.insertions + input.diffStats.deletions : 0;
    if (size > profile.maxDiffLines) reasons.push(`Diff of ${size} lines exceeds the project's ${profile.maxDiffLines}`);
    const newReasons = reasons.filter((r) => !task.riskReasons.includes(r));
    const risk: Risk = reasons.length ? maxRisk(task.risk, "high") : task.risk;

    const tampering = input.tampering ?? [];
    const strikes = (task.verification?.tamperStrikes ?? 0) + (tampering.length ? 1 : 0);
    const passed = input.passed && tampering.length === 0;
    const failures = passed ? 0 : task.verifyFailures + 1;
    let to = afterVerify({ ...task, risk, verifyFailures: failures }, policy, passed);
    let blocker: Blocker | null = null;
    if (tampering.length && strikes >= 2) {
      to = TaskStatus.NeedsHuman;
      blocker = {
        reason: `Tests were weakened again: ${tampering.join("; ")}.`,
        question: "Decide whether the test changes are legitimate; if so, send the task to review, otherwise back to the coder.",
        phase: "verify",
        fromStatus: task.status,
        raisedBy: actor,
        at: now,
      };
    } else if (to === TaskStatus.NeedsHuman) {
      blocker = {
        reason: `Verification failed ${failures} times in a row.`,
        question: "Look at the failing commands: fix the environment, adjust the plan, or send the task back to the coder.",
        phase: "verify",
        fromStatus: task.status,
        raisedBy: actor,
        at: now,
      };
    }

    const lines = evidence.map(
      (e) =>
        `- ${e.skipped ? "⏭" : e.exitCode === 0 ? "✅" : "❌"} \`${e.command ?? e.summary}\`${e.criterionId ? ` (${e.criterionId})` : ""}${e.flaky ? " — flaky, passed on retry" : ""}${e.skipped ? ` — ${e.summary}` : ""}`,
    );
    const message = [
      `## Verification ${passed ? "passed" : "failed"}`,
      "",
      ...lines,
      ...(tampering.length ? ["", "**Test tampering:**", ...tampering.map((t) => `- ${t}`)] : []),
      ...(input.diffStats ? ["", `Diff: ${input.diffStats.files} files, +${input.diffStats.insertions} −${input.diffStats.deletions}`] : []),
      ...(input.verifiedSha && task.headSha && !input.verifiedSha.startsWith(task.headSha) && !task.headSha.startsWith(input.verifiedSha)
        ? ["", `⚠ Verified commit ${input.verifiedSha.slice(0, 12)} differs from the submitted ${task.headSha.slice(0, 12)}.`]
        : []),
      ...(newReasons.length ? ["", `Risk raised to high: ${newReasons.join("; ")}.`] : []),
      ...(!passed && failures ? ["", "Evidence of the failing commands is on the task; the coder fixes them next."] : []),
    ].join("\n");

    const verification: Verification = {
      round,
      passed,
      skipped: false,
      note: null,
      tampering,
      tamperStrikes: strikes,
      verifiedSha: input.verifiedSha ?? null,
      at: now,
    };
    const updated = transitionTask(task, to, {
      actor,
      author: "verifier",
      message,
      messageType: "verify",
      event: passed ? "verification_passed" : "verification_failed",
      details: passed ? undefined : lines.filter((l) => l.includes("❌")).join("\n") || tampering.join("; "),
      release: true,
      patch: {
        acceptanceCriteria: criteria,
        verifyFailures: failures,
        verification,
        diffStats: input.diffStats ?? task.diffStats,
        risk,
        riskReasons: [...task.riskReasons, ...newReasons],
        producers: { ...task.producers, verify: producerOf(task) },
        ...(blocker ? { blocker } : {}),
      },
    });
    if (newReasons.length) addActivity(taskId, "risk_raised", actor, newReasons.join("; "));
    return {
      task: updated,
      previousStatus: task.status,
      newStatus: updated.status,
      message: `Verification ${passed ? "passed" : "failed"}. Task moved to ${statusLabel(updated.status)}.`,
    };
  });
}

export interface ReviewFindingInput extends NewFinding {}

export interface SubmitReviewInput extends SubmitInput {
  verdict: Verdict;
  /** New findings of this round. */
  findings?: ReviewFindingInput[];
  /** Earlier findings the reviewer checked: verified (fixed) or still open. */
  verifiedFindings?: { id: string; status: "verified" | "open" }[];
  /** Required with verdict needs_human: what a person must decide. */
  question?: string;
}

/** Counts AI approvals in the project, this one included, for 1-in-N human sampling. */
function approvalsInProject(projectId: string | null): number {
  if (!projectId) return 1;
  const row = getDbHandle()
    .prepare(
      `SELECT COUNT(*) AS n FROM activity a JOIN tasks t ON t.id = a.task_id
       WHERE t.project_id = ? AND a.event_type = 'review_submitted' AND a.details = 'approve'`,
    )
    .get(projectId) as { n: number };
  return row.n + 1;
}

export function submitReview(taskId: string, input: SubmitReviewInput): SubmitResult {
  return submit(
    taskId,
    { from: TaskStatus.Reviewing, phase: "review", messageType: "review", event: "review_submitted", done: `Review submitted (${input.verdict})` },
    input,
    (task, policy) => {
      const reviewer = task.assignedAgent?.agentId ?? input.author ?? "agent";
      const round = task.codeRound + 1;

      // Earlier findings first: verified ones close, reopened ones count again.
      for (const check of input.verifiedFindings ?? []) {
        const finding = getFinding(taskId, check.id);
        if (!finding) throw new WorkflowError(`Unknown finding ${check.id}.`);
        if (check.status === "verified") {
          updateFinding(taskId, check.id, { status: "verified" });
        } else if (finding.status !== "open") {
          updateFinding(taskId, check.id, { status: "open", reopened: true });
        }
      }
      addFindings(taskId, "R", round, input.findings ?? [], reviewer);
      const open = getOpenFindings(taskId, "code");
      const blocking = open.filter((f) => BLOCKING_SEVERITIES.includes(f.severity));

      if (input.verdict === "approve" && blocking.length) {
        throw new WorkflowError(
          `Cannot approve with open blocker or major findings: ${blocking.map((f) => f.id).join(", ")}. Verify them or request changes.`,
        );
      }
      if (input.verdict === "request_changes" && open.length === 0) {
        throw new WorkflowError("request_changes needs at least one open finding (pass findings[]).");
      }
      if (input.verdict === "needs_human" && !input.question?.trim()) {
        throw new WorkflowError("needs_human needs a question for the person who decides.");
      }

      // The coder said fixed/wontfix and the reviewer reopened it twice: people arbitrate.
      const disputed = getOpenFindings(taskId, "code").filter((f) => f.reopenCount >= 2);
      const sampled =
        input.verdict === "approve" &&
        policy.humanSampleEvery > 0 &&
        approvalsInProject(task.projectId) % policy.humanSampleEvery === 0;
      const routing = afterReview({ ...task, codeRound: round }, policy, input.verdict, {
        sampled,
        disagreement: disputed.length > 0,
      });
      const openIds = open.map((f) => `${f.id} (${f.severity})`).join(", ") || "none";

      let blocker: Blocker | null = null;
      let note: SubmitPlanOut["note"];
      if (routing.reason === "needs_human") {
        blocker = {
          reason: `The reviewer could not decide. Open findings: ${openIds}.`,
          question: input.question!.trim(),
          phase: "review",
          fromStatus: task.status,
          raisedBy: reviewer,
          at: new Date().toISOString(),
        };
      } else if (routing.reason === "disagreement") {
        blocker = {
          reason: `The reviewer and the coder disagree on ${disputed.map((f) => f.id).join(", ")}: it was reopened ${Math.max(...disputed.map((f) => f.reopenCount))} times after the coder marked it fixed or wontfix.`,
          question: "Read the finding and both sides, then decide: send it back to the coder, or accept the coder's answer and approve.",
          phase: "review",
          fromStatus: task.status,
          raisedBy: "system",
          at: new Date().toISOString(),
        };
        note = { message: `Reviewer and coder disagree; a person arbitrates. ${blocker.reason}`, event: "review_escalated" };
      } else if (routing.reason === "round_limit") {
        blocker = {
          reason: `The reviewer asked for changes ${round - (task.roundBaseline.code ?? 0)} times (limit ${policy.maxReviewRounds}). Open findings: ${openIds}.`,
          question: "Read the open findings and decide: send the task back for another round, take over the fix, or approve it as is.",
          phase: "review",
          fromStatus: task.status,
          raisedBy: "system",
          at: new Date().toISOString(),
        };
        note = { message: `Review round limit reached; a person decides. ${blocker.reason}`, event: "review_escalated" };
      } else if (routing.reason === "high_risk") {
        note = { message: "The AI reviewer approved; the task is high risk, so a person reviews the code too.", event: "review_escalated" };
      } else if (routing.reason === "sampled") {
        note = {
          message: `The AI reviewer approved; this approval was picked for a human spot check (1 in ${policy.humanSampleEvery}).`,
          event: "review_sampled",
        };
      }

      return {
        to: routing.status,
        message: input.message,
        details: input.verdict,
        note,
        patch: {
          codeRound: round,
          lastReview: { round, verdict: input.verdict, by: reviewer, at: new Date().toISOString() },
          ...(blocker ? { blocker } : {}),
        },
      };
    },
  );
}

export interface SubmitPrInput extends SubmitInput {
  prUrl?: string;
  prNumber?: number;
  /** PR base (task.mergeBranch). */
  branch: string;
  /** Feature-branch head pushed to origin. */
  commit: string;
  authors: string;
  worktree?: string;
  /** Head branch; defaults to task.recommendedBranch. */
  headBranch?: string;
}

function prNumberOf(url: string | undefined): number | null {
  const m = url?.match(/\/(?:pull|pulls|merge_requests|pull-requests)\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** The agent with the `pr` role opened the PR: the task waits in pr_open until it is merged on GitHub. */
export function submitPr(taskId: string, input: SubmitPrInput): SubmitResult {
  const url = input.prUrl?.trim() || input.message?.match(PR_URL_RE)?.[0];
  // archive.ts parses this format (Branch/Commit/Authors/Worktree/Message).
  const details = [
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
    { from: TaskStatus.Merging, phase: "merge", messageType: "merge", event: "pr_opened", done: "Pull request recorded" },
    input,
    (task) => ({
      to: TaskStatus.PrOpen,
      message: `${url ? `PR opened: ${url}. ` : "PR opened. "}${details}`,
      details: url ?? details,
      patch: {
        headSha: input.commit || task.headSha,
        realBranch: input.headBranch?.trim() || task.realBranch || task.recommendedBranch,
        pullRequest: {
          url: url ?? null,
          number: input.prNumber ?? prNumberOf(url),
          state: "open",
          branch: input.headBranch?.trim() || task.realBranch || task.recommendedBranch,
          mergedAt: null,
          mergedBy: null,
          changesRequestedBy: [],
          checks: null,
          checkedAt: null,
        },
      },
    }),
  );
}

/** Older clients: submit_merge records the PR the same way (URL taken from the message). */
export function submitMerge(taskId: string, input: SubmitMergeInput): SubmitResult {
  return submitPr(taskId, { ...input });
}

export function postComment(taskId: string, input: { message: string; author?: string }): Task {
  const task = requireTask(taskId);
  const author = input.author ?? "agent";
  const updated = addConversation(task, author, input.message, "agent");
  addActivity(task.id, "comment_added", author, input.message);
  return updated;
}
