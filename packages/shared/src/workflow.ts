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
  getUnverifiedFindings,
  updateFinding,
  type NewEvidence,
  type NewFinding,
} from "./records.js";
import { normalizeCriteria, type CriterionInput } from "./criteria.js";
import { matchesAny, profileCommands, resolveProfile } from "./profile.js";
import { checkDefinitionOfReady, type ReadinessInput } from "./dor.js";
import { analyzeDiff, diffRiskReasons, mergeDiffReasons, protectedFiles } from "./diff.js";

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
  modelKey,
  resolveTargets,
  sessionIdentity,
  statusLabel,
  maxRisk,
  toolKey,
  type CriterionStatus,
  type Phase,
  type Risk,
  type Role,
  type Verdict,
} from "./catalog.js";
import { detectDefaultBranch, git, sameCommit } from "./git.js";
import type {
  AgentReference,
  Agent,
  Approval,
  ApprovedPlan,
  CommitRecord,
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

/**
 * The round a handoff written in `phase` belongs to, read from the task before
 * the change: a plan and its critique share round k (the critique's findings
 * are P<k>), and so do a code submission, its verification and its review
 * (evidence of round k, findings R<k>). A merge follows the last review round;
 * a refinement comes before any round. People's notes and claims take the
 * round of the phase they feed.
 */
function handoffRound(task: Pick<Task, "planRound" | "codeRound">, phase: Phase): number {
  switch (phase) {
    case "plan":
    case "plan_review":
      return task.planRound + 1;
    case "code":
    case "verify":
    case "review":
      return task.codeRound + 1;
    case "merge":
      return task.codeRound;
    case "refine":
      return 0;
  }
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
   * Identity of the process the claim comes through (the MCP server passes
   * `mcp:<instance>`). It keeps separation of duties within that process when
   * the agent's sessionId changes or is a placeholder.
   */
  instanceKey?: string;
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

  const identities = claimIdentities(input);
  const sessionKey = identities[0];
  const claimModel = modelKey(input.agent.toolName, input.agent.model);
  return withTransaction(() => {
    const candidates = getClaimableTasks(
      claimableStatuses,
      input.projectId,
      MAX_CLAIM_ATTEMPTS,
      input.excludeTaskIds ?? [],
      { identities, modelKey: claimModel, model: input.agent.model },
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
        identities,
        modelKey: claimModel,
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
        addHandoff(candidate.id, {
          phase: "claim",
          round: handoffRound(candidate, STATUS_INFO[newStatus].phase ?? "code"),
          agentId: agent.id,
          summary: context,
        });
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

/**
 * Who a claim is, for separation of duties, the primary identity first. A runner
 * claim is its runner (`runner:<id>`, the same for all its jobs). Any other claim
 * is its conversation (`session:<tool>:<sessionId>`, which survives restarts of
 * the MCP server) and the process it came through (`instanceKey`).
 */
function claimIdentities(input: ClaimNextTaskInput): string[] {
  const primary = input.runnerId
    ? `runner:${input.runnerId}`
    : sessionIdentity(input.agent.toolName, input.agent.sessionId);
  const identities = [...new Set([primary, input.instanceKey].filter((k): k is string => !!k))];
  // A placeholder sessionId with nothing else to go on still names the claim.
  return identities.length > 0
    ? identities
    : [`session:${toolKey(input.agent.toolName)}:${input.agent.sessionId.trim()}`];
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
        round: handoffRound(task, blocker.phase ?? "code"),
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
  const head = input.targetStatus === TaskStatus.Approved ? reviewedHead(getTaskById(taskId)) : null;
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
    // Sending reviewed code on to the PR is a person's approval of it. After a merge
    // blocker (a closed PR) the code did not change: the approval it had stands.
    const approves = input.targetStatus === TaskStatus.Approved && task.blocker?.phase !== "merge";
    // Sending weakened tests on (not back to the coder) accepts them: the diff is
    // cumulative, so without this the same lines would be flagged on every later check.
    const v = task.verification;
    const accepts =
      task.blocker?.phase === "verify" &&
      input.targetStatus !== TaskStatus.ChangesRequested &&
      input.targetStatus !== TaskStatus.Canceled &&
      !!v?.tampering.length;
    if (answer) {
      addHandoff(taskId, {
        phase: "human",
        round: handoffRound(task, task.blocker?.phase ?? "code"),
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
      // A person's answer gives the agents a fresh set of rounds, verifications and tamper strikes.
      patch: {
        blocker: null,
        revertStreak: 0,
        roundBaseline: { plan: task.planRound, code: task.codeRound },
        ...(approves ? { approval: approvalOf(task, head, actor, true) } : {}),
        verifyFailures: 0,
        ...(v
          ? {
              verification: {
                ...v,
                tamperStrikes: 0,
                acceptedTampering: accepts ? [...new Set([...(v.acceptedTampering ?? []), ...v.tampering])] : v.acceptedTampering,
              },
            }
          : {}),
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
  if (!plan) throw new WorkflowError("There is no plan to approve: the task has no submitted plan yet.");
  return {
    markdown: plan.message,
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

/**
 * The commit and branch a worktree has checked out, as the server reads them
 * (nulls without a worktree, or when git cannot read it). Read them before a
 * transaction: git can take a while.
 */
function checkedOut(worktree: string | null | undefined): { sha: string | null; branch: string | null } {
  if (!worktree) return { sha: null, branch: null };
  return {
    sha: git(worktree, ["rev-parse", "HEAD"]) || null,
    // Empty on a detached HEAD.
    branch: git(worktree, ["branch", "--show-current"]) || null,
  };
}

/** The commit a review of the task looks at: the worktree's HEAD, else the submitted commit. */
function reviewedHead(task: Task | null): string | null {
  if (!task) return null;
  return checkedOut(task.worktreePath).sha || task.headSha || task.verification?.verifiedSha || null;
}

/** The task's commit log with one more entry (unchanged without a sha). */
function withCommit(task: Task, phase: CommitRecord["phase"], sha: string | null | undefined, round: number, branch: string | null): CommitRecord[] {
  const id = sha?.trim();
  return id ? [...task.commits, { round, phase, sha: id, branch, at: new Date().toISOString() }] : task.commits;
}

function approvalOf(task: Task, sha: string | null, by: string, human: boolean): Approval {
  return { sha, by, human, round: task.codeRound, at: new Date().toISOString() };
}

/** A person's change request, for the agent of `phase` (the round it will work). */
function humanHandoff(taskId: string, phase: Phase, summary: string | undefined, actor = "user"): void {
  const task = getTaskById(taskId);
  if (task && summary?.trim()) addHandoff(taskId, { phase: "human", round: handoffRound(task, phase), agentId: actor, summary });
}

export function requestPlanChanges(taskId: string, input: HumanActionInput = {}): Task {
  const message = input.message?.trim();
  humanHandoff(taskId, "plan", message, input.actor);
  return humanTransition(taskId, TaskStatus.WaitingPlanReview, TaskStatus.PlanChangesRequested, "plan_changes_requested", message || "Plan changes requested.", input, message);
}

/** A person approves the code: the commit in the worktree is the one the PR may ship. */
export function approveCode(taskId: string, input: HumanActionInput = {}): Task {
  const sha = reviewedHead(getTaskById(taskId));
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.WaitingCodeReview) {
      throw new WorkflowError(`task must be in ${statusLabel(TaskStatus.WaitingCodeReview)} status`);
    }
    const actor = input.actor ?? "user";
    return transitionTask(task, TaskStatus.Approved, {
      actor,
      message: input.message?.trim() || "Code approved.",
      messageType: "user",
      event: "code_approved",
      patch: { revertStreak: 0, approval: approvalOf(task, sha, actor, true) },
    });
  });
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
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.WaitingCodeReview) {
      throw new WorkflowError(`task must be in ${statusLabel(TaskStatus.WaitingCodeReview)} status`);
    }
    return sendBackToCoder(task, input, "code_changes_requested", "Code changes requested.");
  });
}

/**
 * A person asks for changes on the open pull request (on the task page, or a
 * change request on GitHub the PR sync picked up). As with requestCodeChanges
 * the message becomes a finding the coder answers by id. The PR stays open and
 * stays on the task: the coder commits on the same branch, the code goes
 * through verification and review again, and the pr phase updates the same PR.
 */
export function requestPrChanges(taskId: string, input: RequestCodeChangesInput = {}): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    if (task.status !== TaskStatus.PrOpen) {
      throw new WorkflowError(`task must be in ${statusLabel(TaskStatus.PrOpen)} status`);
    }
    return sendBackToCoder(task, input, "pr_changes_requested", "Changes requested on the pull request.");
  });
}

/** Reopens the chosen findings, records the message as a finding (H<round>-<n>) and sends the task to the coder. */
function sendBackToCoder(task: Task, input: RequestCodeChangesInput, event: string, fallback: string): Task {
  const message = input.message?.trim();
  const actor = input.actor ?? "user";
  for (const id of input.findingIds ?? []) {
    const finding = getFinding(task.id, id);
    if (!finding) throw new WorkflowError(`Unknown finding ${id}.`);
    if (finding.status !== "open") updateFinding(task.id, id, { status: "open", reopened: true });
  }
  if (message && input.asFinding !== false) {
    addFindings(task.id, "H", Math.max(1, task.codeRound), [{ severity: "major", text: message }], actor);
  }
  humanHandoff(task.id, "code", message, actor);
  const reopened = input.findingIds?.length ? `\n\nReopened: ${input.findingIds.join(", ")}` : "";
  return transitionTask(task, TaskStatus.ChangesRequested, {
    actor,
    message: (message || fallback) + reopened,
    messageType: "user",
    event,
    details: message,
    patch: { revertStreak: 0 },
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
  humanHandoff(taskId, "plan", message, input.actor);
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
      question: "Reopen it and send the task back to PR open, send it back to Approved for a new PR or to the coder (Changes requested), or cancel it.",
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

/**
 * Who produced a phase's artifact: the claim that submits it, plus the identities
 * and models of the earlier rounds' producers (`previous`), since their work is
 * still in the artifact.
 */
function producerOf(task: Task, previous?: Producer): Producer {
  const agent = task.assignedAgent;
  const keyOf = (p: { tool?: string | null; model?: string | null } | undefined) =>
    p?.model ? modelKey(p.tool, p.model) : null;
  const union = (...lists: (string | null | undefined)[][]) =>
    [...new Set(lists.flat().filter((v): v is string => !!v))];
  return {
    sessionKey: agent?.sessionKey ?? null,
    identities: union(
      previous?.identities ?? [previous?.sessionKey],
      agent?.identities ?? [agent?.sessionKey],
    ),
    agentId: agent?.agentId ?? null,
    tool: agent?.tool ?? null,
    model: agent?.model ?? null,
    modelKeys: union(previous?.modelKeys ?? [keyOf(previous)], [agent?.modelKey ?? keyOf(agent ?? undefined)]),
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
  /** More activity events written after the transition (e.g. risk_raised). */
  events?: { event: string; details: string }[];
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
        producers: { ...task.producers, [spec.phase]: producerOf(task, task.producers[spec.phase]) },
      },
    });
    if (input.context?.trim()) {
      addHandoff(taskId, {
        phase: spec.phase,
        round: handoffRound(task, spec.phase),
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
    for (const e of out.events ?? []) addActivity(taskId, e.event, "system", e.details);
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
  /** An answer for every open plan finding (P…): fixed, or wontfix with the reason. */
  findingResolutions?: { id: string; status: "fixed" | "wontfix"; resolution: string }[];
}

/**
 * The planner answers the critic's open findings by id, as the coder answers a
 * review: every open plan finding needs one, and only plan findings the critic
 * has not verified yet can be answered. The critic then checks each answer.
 */
function answerPlanFindings(taskId: string, answers: SubmitPlanInput["findingResolutions"] = []): void {
  const resolutions = new Map(answers.map((r) => [r.id, r]));
  const missing = getOpenFindings(taskId, "plan").filter((f) => !resolutions.has(f.id)).map((f) => f.id);
  if (missing.length) {
    throw new WorkflowError(
      `Answer every open plan finding in findingResolutions (fixed, or wontfix with a reason): ${missing.join(", ")}.`,
    );
  }
  for (const r of resolutions.values()) {
    const finding = getFinding(taskId, r.id);
    if (!finding) throw new WorkflowError(`Unknown finding ${r.id}.`);
    if (finding.phase !== "plan" || finding.status === "verified") {
      throw new WorkflowError(
        `Finding ${r.id} is not an open plan finding (${finding.phase === "plan" ? finding.status : "code finding"}); answer only the open plan findings.`,
      );
    }
    if (r.status !== "fixed" && r.status !== "wontfix") {
      throw new WorkflowError(`Finding ${r.id}: the answer must be fixed or wontfix.`);
    }
    updateFinding(taskId, r.id, { status: r.status, resolution: r.resolution.trim() });
  }
}

/**
 * A plan must say how every acceptance criterion (except waived ones) is
 * checked: at least one validationPlan item per criterion, a command or, for a
 * manual check, just `how`. A task without criteria needs none.
 */
function checkValidationPlan(task: Task, plan: ValidationPlan | undefined): ValidationPlan | undefined {
  const ids = new Set(task.acceptanceCriteria.map((c) => c.id));
  const required = task.acceptanceCriteria.filter((c) => c.status !== "waived").map((c) => c.id);
  if (!plan) {
    if (!required.length) return undefined;
    throw new WorkflowError(
      `validationPlan is required: add an item per acceptance criterion (${required.join(", ")}); use "how" alone for a manual check.`,
    );
  }
  const unknown = plan.items.map((i) => i.criterionId).filter((id) => !ids.has(id));
  if (unknown.length) {
    throw new WorkflowError(
      `validationPlan names unknown criteria: ${unknown.join(", ")}. The task's criteria are ${[...ids].join(", ") || "none"}.`,
    );
  }
  const covered = new Set(plan.items.map((i) => i.criterionId));
  const missing = required.filter((id) => !covered.has(id));
  if (missing.length) {
    throw new WorkflowError(
      `validationPlan misses criteria: ${missing.join(", ")} (add an item per criterion; use "how" alone for a manual check).`,
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
      answerPlanFindings(taskId, input.findingResolutions);
      const validationPlan = checkValidationPlan(task, input.validationPlan);
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
      const newReasons = reasons.filter((r) => !task.riskReasons.includes(r));
      return {
        to: afterPlan({ ...task, risk }, policy, { blockingQuestions: blocking.length > 0 }),
        message: input.message,
        events: newReasons.length ? [{ event: "risk_raised", details: newReasons.join("; ") }] : [],
        ...(sizeWarnings.length ? { note: { message: ["**Plan size:**", ...sizeWarnings.map((w) => `- ${w}`)].join("\n") } } : {}),
        patch: {
          // A revision without a validation plan clears the previous one: approval freezes only this plan's.
          validationPlan: validationPlan ?? null,
          planSubmission: submission,
          risk,
          riskReasons: [...task.riskReasons, ...newReasons],
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
      messageType: "plan_review",
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
      // An answered (fixed/wontfix) blocker or major finding still needs the critic to verify it.
      const blocking = getUnverifiedFindings(taskId, "plan").filter((f) => BLOCKING_SEVERITIES.includes(f.severity));
      if (input.verdict === "approve" && blocking.length) {
        throw new WorkflowError(
          `Cannot approve a plan with open blocker or major findings: ${blocking.map((f) => `${f.id} (${f.status})`).join(", ")}. Pass fixed/wontfix ones in verifiedFindings as verified, or request changes.`,
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
    { from: TaskStatus.Refining, phase: "refine", messageType: "refine", event: "draft_refined", done: "Draft refined" },
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

/**
 * The verification record of code that is not (or not yet) verified. It replaces
 * the previous result, so the reviewer, the PR body and the portal never show an
 * earlier submission's outcome as this one's; the tamper strikes carry over.
 */
export function unverifiedRecord(task: Task, note: string, round = task.verification?.round ?? task.codeRound + 1): Verification {
  return {
    round,
    passed: false,
    skipped: true,
    note,
    tampering: [],
    tamperStrikes: task.verification?.tamperStrikes ?? 0,
    acceptedTampering: task.verification?.acceptedTampering,
    verifiedSha: null,
    at: new Date().toISOString(),
    evidenceIds: [],
  };
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

/** What a task's diff shows, as the verifier reports it. */
interface DiffFacts {
  diffStats: DiffStats | null;
  /** Changed files under the project's protected paths. */
  touchedProtected: string[];
  tampering: string[];
  headSha?: string | null;
}

function profileOf(task: Task) {
  return resolveProfile(task.projectId ? getProjectById(task.projectId)?.profile : null);
}

/** Reads the diff of a worktree. Call it before the transaction: git can take a while. */
function worktreeFacts(task: Task | null, worktree: string | null | undefined): DiffFacts | null {
  if (!task || !worktree) return null;
  const diff = analyzeDiff(worktree, task.mergeBranch);
  if (!diff) return null;
  return {
    diffStats: diff.diffStats,
    touchedProtected: protectedFiles(diff.changedFiles, profileOf(task)),
    tampering: diff.tampering,
    headSha: diff.headSha,
  };
}

/**
 * The guards every code submission goes through, whether or not the verifier
 * runs: protected paths or a diff over maxDiffLines raise the risk to high
 * (never lower it), and the tampering found (less what a person accepted) is
 * returned for routing.
 */
function diffGuards(task: Task, facts: DiffFacts | null) {
  const reasons = facts ? diffRiskReasons(facts.touchedProtected, facts.diffStats, profileOf(task)) : [];
  const { riskReasons, added } = mergeDiffReasons(task.riskReasons, reasons);
  const accepted = new Set(task.verification?.acceptedTampering ?? []);
  return {
    risk: reasons.length ? maxRisk(task.risk, "high") : task.risk,
    riskReasons,
    newReasons: added,
    tampering: [...new Set(facts?.tampering ?? [])].filter((t) => !accepted.has(t)),
  };
}

interface FailedCheck {
  tampering: string[];
  /** Tamper strikes, this one included. */
  strikes: number;
  /** Consecutive failed verifications, this one included. */
  failures: number;
  /** What failed this time (markdown list items), shown to the person if it escalates. */
  failing: string[];
  actor: string;
  now: string;
}

/**
 * Where a failed verification (or tampering found on submit) sends the task:
 * back to the coder, or to a person once tests were weakened twice or the
 * verification failed `maxVerifyFailures` times in a row.
 */
function afterFailedCheck(task: Task, policy: GatePolicy, risk: Risk, f: FailedCheck): { to: TaskStatus; blocker: Blocker | null } {
  const to = afterVerify({ ...task, risk, verifyFailures: f.failures }, policy, false);
  const blocker = (reason: string, question: string): Blocker => ({
    reason,
    question,
    phase: "verify",
    fromStatus: task.status,
    raisedBy: f.actor,
    at: f.now,
  });
  if (f.tampering.length && f.strikes >= 2) {
    return {
      to: TaskStatus.NeedsHuman,
      blocker: blocker(
        `Tests were weakened again: ${f.tampering.join("; ")}.`,
        "Decide whether the test changes are legitimate; if so, send the task to review, otherwise back to the coder.",
      ),
    };
  }
  if (to === TaskStatus.NeedsHuman) {
    return {
      to,
      blocker: blocker(
        [`Verification failed ${f.failures} times in a row.`, ...(f.failing.length ? ["", "Failing now:", ...f.failing] : [])].join("\n"),
        "Look at the failing commands: fix the environment, adjust the plan, or send the task back to the coder.",
      ),
    };
  }
  return { to, blocker: null };
}

/**
 * Raises a task's risk to high for what a diff shows outside a submission
 * (e.g. the files of its pull request), with a risk_raised event.
 */
export function raiseRisk(taskId: string, reasons: string[], actor: string): Task {
  return withTransaction(() => {
    const task = requireTask(taskId);
    const { riskReasons, added } = mergeDiffReasons(task.riskReasons, reasons);
    patchTask(taskId, { risk: maxRisk(task.risk, "high"), riskReasons });
    if (added.length) {
      addConversation(task, "system", `Risk raised to high: ${added.join("; ")}.`, "system");
      addActivity(taskId, "risk_raised", actor, added.join("; "));
    }
    return getTaskById(taskId)!;
  });
}

export function submitCode(taskId: string, input: SubmitCodeInput = {}): SubmitResult {
  // The server reads the submitted commit and branch from the worktree itself (before
  // the transaction); the agent's headSha and branch only count when it cannot.
  const head = checkedOut(input.worktree);
  // The diff is read before the transaction, so git never runs while the database is locked.
  const facts = worktreeFacts(getTaskById(taskId), input.worktree);
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
        const finding = getFinding(taskId, r.id);
        if (!finding) throw new WorkflowError(`Unknown finding ${r.id}.`);
        // Only code findings a reviewer has not closed yet: never a plan finding, never a verified one.
        if (finding.phase !== "code" || finding.status === "verified") {
          throw new WorkflowError(
            `Finding ${r.id} is not an open code finding (${finding.phase === "code" ? finding.status : "plan finding"}); answer only the open code findings.`,
          );
        }
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

      const now = new Date().toISOString();
      const guards = diffGuards(task, facts);
      const sha = head.sha ?? (input.headSha?.trim() || null);
      const branch = head.branch ?? (input.branch?.trim() || task.realBranch);
      const patch: TaskPatch = {
        worktreePath: input.worktree ?? null,
        realBranch: branch,
        // A submission that names no commit keeps the previous one rather than erasing it.
        headSha: sha ?? task.headSha,
        commits: withCommit(task, "code", sha, round, branch),
        acceptanceCriteria: criteria,
        diffStats: facts?.diffStats ?? task.diffStats,
        risk: guards.risk,
        riskReasons: guards.riskReasons,
        // The last AI verdict was about the previous submission.
        ...(task.lastReview ? { lastReview: { ...task.lastReview, stale: true } } : {}),
      };
      const events = guards.newReasons.length ? [{ event: "risk_raised", details: guards.newReasons.join("; ") }] : [];
      const raised = guards.newReasons.length ? `Risk raised to high: ${guards.newReasons.join("; ")}.` : null;

      // Weakened tests send the code back at once, whether or not the verifier would run.
      if (guards.tampering.length) {
        const strikes = (task.verification?.tamperStrikes ?? 0) + 1;
        const failures = task.verifyFailures + 1;
        const routed = afterFailedCheck(task, policy, guards.risk, {
          tampering: guards.tampering,
          strikes,
          failures,
          failing: guards.tampering.map((t) => `- ${t}`),
          actor: author,
          now,
        });
        return {
          to: routed.to,
          message: input.message,
          events,
          note: {
            message: [
              "**Test tampering** in the submitted commits, so the code goes back without running the verification:",
              ...guards.tampering.map((t) => `- ${t}`),
              ...(raised ? ["", raised] : []),
            ].join("\n"),
            event: "verification_failed",
          },
          patch: {
            ...patch,
            verifyFailures: failures,
            verification: {
              round,
              passed: false,
              skipped: false,
              note: "Tests were weakened in the submitted commits; the verification commands did not run.",
              tampering: guards.tampering,
              tamperStrikes: strikes,
              acceptedTampering: task.verification?.acceptedTampering,
              verifiedSha: facts?.headSha ?? null,
              at: now,
              evidenceIds: [],
            },
            ...(routed.blocker ? { blocker: routed.blocker } : {}),
          },
        };
      }

      const verifyNow = hasVerificationCommands(task) && verifierOnline();
      // Never leave the previous submission's result on the task: until the verifier
      // reports, this code is not verified.
      const verification = unverifiedRecord(
        task,
        verifyNow
          ? "Waiting for the verifier."
          : hasVerificationCommands(task)
            ? "Not verified: the AgentQ web server (which runs the verifier) is not running."
            : "Not verified: the project has no commands configured (Projects → Edit → Commands).",
        round,
      );

      return {
        to: afterCode(task, policy, { verify: verifyNow }),
        message: input.message,
        events,
        ...(raised ? { note: { message: raised } } : {}),
        patch: { ...patch, verification },
      };
    },
  );
}

export interface SubmitVerificationInput extends ClaimAuth, Pick<SubmitInput, "context" | "decisions" | "risks" | "next"> {
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
  /**
   * Nothing that checks the code ran (every command skipped, or only install):
   * why. The code goes on to review marked as not verified, never as a pass.
   */
  unverifiedNote?: string;
  author?: string;
}

/**
 * The verifier reports: evidence per command, criteria met/failed, and where
 * the task goes. When the report carries no diff (an agent verifier over MCP),
 * the server reads the worktree's diff itself, so risk and tampering never
 * depend on what the verifier chose to report.
 */
export function submitVerification(taskId: string, input: SubmitVerificationInput): SubmitResult {
  const current = input.infraError || input.diffStats !== undefined ? null : getTaskById(taskId);
  const facts = worktreeFacts(current, current?.worktreePath);
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
        patch: { blocker, verification: unverifiedRecord(task, input.infraError, round) },
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

    // Risk only goes up (protected paths, a diff larger than the project allows), and
    // the server's own reading of the diff adds to what the verifier reported.
    const diffStats = input.diffStats !== undefined ? input.diffStats : (facts?.diffStats ?? null);
    const guards = diffGuards(task, {
      diffStats,
      touchedProtected: [...new Set([...(input.touchedProtected ?? []), ...(facts?.touchedProtected ?? [])])],
      tampering: [...(input.tampering ?? []), ...(facts?.tampering ?? [])],
    });
    const { risk, newReasons, tampering } = guards;
    const verifiedSha = input.verifiedSha ?? facts?.headSha ?? null;

    const strikes = (task.verification?.tamperStrikes ?? 0) + (tampering.length ? 1 : 0);
    // A pass needs at least one command that ran: a report where everything was skipped is not verified.
    const ran = evidence.some((e) => !e.skipped && e.exitCode !== null);
    const notVerified =
      input.passed && tampering.length === 0
        ? (input.unverifiedNote ?? (ran ? undefined : "Not verified: the verifier reported no command that ran."))
        : undefined;
    const passed = input.passed && tampering.length === 0 && !notVerified;
    const failures = passed ? 0 : notVerified ? task.verifyFailures : task.verifyFailures + 1;
    const lines = evidence.map(
      (e) =>
        `- ${e.skipped ? "⏭" : e.exitCode === 0 ? "✅" : "❌"} \`${e.command ?? e.summary}\`${e.criterionId ? ` (${e.criterionId})` : ""}${e.flaky ? " — flaky, passed on retry" : ""}${e.skipped ? ` — ${e.summary}` : ""}`,
    );
    const failing = [...lines.filter((l) => l.includes("❌")), ...tampering.map((t) => `- ${t}`)];
    const { to, blocker } =
      passed || notVerified
        ? { to: afterVerify({ ...task, risk, verifyFailures: failures }, policy, true), blocker: null }
        : afterFailedCheck(task, policy, risk, { tampering, strikes, failures, failing, actor, now });
    const message = [
      `## Verification ${passed ? "passed" : notVerified ? "skipped" : "failed"}`,
      "",
      ...(notVerified ? [notVerified, ""] : []),
      ...lines,
      ...(tampering.length ? ["", "**Test tampering:**", ...tampering.map((t) => `- ${t}`)] : []),
      ...(diffStats ? ["", `Diff: ${diffStats.files} files, +${diffStats.insertions} −${diffStats.deletions}`] : []),
      ...(verifiedSha && task.headSha && !verifiedSha.startsWith(task.headSha) && !task.headSha.startsWith(verifiedSha)
        ? ["", `⚠ Verified commit ${verifiedSha.slice(0, 12)} differs from the submitted ${task.headSha.slice(0, 12)}.`]
        : []),
      ...(newReasons.length ? ["", `Risk raised to high: ${newReasons.join("; ")}.`] : []),
      ...(!passed && !notVerified && failures ? ["", "Evidence of the failing commands is on the task; the coder fixes them next."] : []),
    ].join("\n");

    const verification: Verification = {
      round,
      passed,
      skipped: !!notVerified,
      note: notVerified ?? null,
      tampering,
      tamperStrikes: strikes,
      acceptedTampering: task.verification?.acceptedTampering,
      verifiedSha,
      at: now,
      evidenceIds: evidence.map((e) => e.id),
    };
    const updated = transitionTask(task, to, {
      actor,
      author: "verifier",
      message,
      messageType: "verify",
      event: passed ? "verification_passed" : notVerified ? "verification_skipped" : "verification_failed",
      details: passed ? undefined : notVerified ?? (lines.filter((l) => l.includes("❌")).join("\n") || tampering.join("; ")),
      release: true,
      context: input.context,
      patch: {
        acceptanceCriteria: criteria,
        verifyFailures: failures,
        verification,
        diffStats: diffStats ?? task.diffStats,
        risk,
        riskReasons: guards.riskReasons,
        commits: withCommit(task, "verify", input.verifiedSha, round, task.realBranch),
        producers: { ...task.producers, verify: producerOf(task) },
        ...(blocker ? { blocker } : {}),
      },
    });
    if (newReasons.length) addActivity(taskId, "risk_raised", actor, newReasons.join("; "));
    // An agent verifier's handoff reaches the coder's brief (the reviewer never reads handoffs).
    if (input.context?.trim()) {
      addHandoff(taskId, {
        phase: "verify",
        round,
        agentId: actor,
        summary: input.context,
        decisions: input.decisions,
        risks: input.risks,
        next: input.next,
      });
    }
    return {
      task: updated,
      previousStatus: task.status,
      newStatus: updated.status,
      message: `Verification ${passed ? "passed" : notVerified ? "skipped (nothing ran)" : "failed"}. Task moved to ${statusLabel(updated.status)}.`,
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
  // The commit under review, read before the transaction: an approval pins it for the PR.
  const reviewed = reviewedHead(getTaskById(taskId));
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
      // The coder's "fixed" or "wontfix" is a claim: a blocker or major finding closes only when a reviewer verifies it.
      const blocking = getUnverifiedFindings(taskId, "code").filter((f) => BLOCKING_SEVERITIES.includes(f.severity));

      if (input.verdict === "approve" && blocking.length) {
        throw new WorkflowError(
          `Cannot approve with open blocker or major findings: ${blocking.map((f) => `${f.id} (${f.status})`).join(", ")}. Pass fixed/wontfix ones in verifiedFindings as verified, or request changes.`,
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
          lastReview: { round, verdict: input.verdict, by: reviewer, at: new Date().toISOString(), sha: reviewed },
          ...(routing.status === TaskStatus.Approved ? { approval: approvalOf({ ...task, codeRound: round }, reviewed, reviewer, false) } : {}),
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

/**
 * The agent with the `pr` role opened the PR: the task waits in pr_open until
 * it is merged on GitHub. A pushed commit other than the approved one (commits
 * nobody verified or reviewed) sends the task to a person instead.
 */
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
    (task) => {
      const approved = task.approval?.sha;
      const pushed = input.commit.trim();
      const blocker: Blocker | null =
        approved && pushed && !sameCommit(approved, pushed)
          ? {
              reason: `The pull request's head ${pushed.slice(0, 12)} is not the approved commit ${approved.slice(0, 12)}: it carries commits nobody verified or reviewed.`,
              question:
                "Send the task back to the coder (Changes requested) so the extra commits are verified and reviewed, accept the PR as it is (PR open; the L3 auto-merge stays off), or cancel it.",
              phase: "merge",
              fromStatus: task.status,
              raisedBy: "system",
              at: new Date().toISOString(),
            }
          : null;
      const base = input.branch.trim();
      if (base && base !== task.mergeBranch) {
        addActivity(taskId, "pr_base_mismatch", "system", `The pull request targets ${base}, not the task's merge branch ${task.mergeBranch}.`);
      }
      const headBranch = input.headBranch?.trim() || task.realBranch || task.recommendedBranch;
      // The PR's commit belongs to the round of the latest code submission.
      const round = task.commits.filter((c) => c.phase === "code").at(-1)?.round ?? Math.max(1, task.codeRound);
      return {
        to: blocker ? TaskStatus.NeedsHuman : TaskStatus.PrOpen,
        message: `${url ? `PR opened: ${url}. ` : "PR opened. "}${details}`,
        details: url ?? details,
        ...(blocker ? { note: { message: `**Blocked:** ${blocker.reason}\n\n**Question:** ${blocker.question}`, event: "task_blocked" } } : {}),
        patch: {
          headSha: pushed || task.headSha,
          realBranch: headBranch,
          commits: withCommit(task, "pr", pushed, round, headBranch),
          pullRequest: {
            url: url ?? null,
            number: input.prNumber ?? prNumberOf(url),
            state: "open",
            branch: headBranch,
            base: base || null,
            authors: input.authors.trim() || null,
            headSha: pushed || null,
            mergedAt: null,
            mergedBy: null,
            changesRequestedBy: [],
            // Kept across PRs of the task: a reopened PR still counts the earlier change requests.
            changesEverRequestedBy: task.pullRequest?.changesEverRequestedBy ?? task.pullRequest?.changesRequestedBy ?? [],
            checks: null,
            checkedAt: null,
          },
          ...(blocker ? { blocker } : {}),
        },
      };
    },
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
