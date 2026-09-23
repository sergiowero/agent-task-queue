import {
  updateTask,
  addActivityEvent,
  createAgent,
  getTaskById,
  getClaimableTasks,
  tryAssignTask,
  withTransaction,
} from "./database.js";
import type { Task, Agent, AgentReference } from "./types.js";
import { TaskStatus } from "./types.js";

export const ROLE_STATUSES: Record<string, TaskStatus[]> = {
  planner: [TaskStatus.PlanRequested, TaskStatus.PlanChangesRequested],
  implementer: [TaskStatus.ReadyForCode, TaskStatus.ChangesRequested, TaskStatus.Approved],
  reviewer: [TaskStatus.CodeReviewRequested],
};

export const COMPOUND_ROLES: Record<string, string[]> = {
  senior: ["planner", "implementer", "reviewer"],
  architect: ["planner", "reviewer"],
};

export const CANCELED_CANT_CANCEL = new Set([TaskStatus.Canceled, TaskStatus.Complete, TaskStatus.Merged]);

export const CANT_DELETE_STATUSES = new Set([
  TaskStatus.Coding,
  TaskStatus.WaitingCodeReview,
  TaskStatus.CodeReviewRequested,
  TaskStatus.Reviewing,
  TaskStatus.ChangesRequested,
  TaskStatus.Approved,
  TaskStatus.Merging,
  TaskStatus.Merged,
  TaskStatus.Complete,
  TaskStatus.Canceled,
]);

export function getClaimableStatuses(role: string): TaskStatus[] {
  if (ROLE_STATUSES[role]) {
    return ROLE_STATUSES[role];
  }
  if (COMPOUND_ROLES[role]) {
    const statuses: TaskStatus[] = [];
    for (const subRole of COMPOUND_ROLES[role]) {
      statuses.push(...ROLE_STATUSES[subRole]);
    }
    return statuses;
  }
  return [];
}

export function getClaimTransition(status: TaskStatus, role: string): TaskStatus | null {
  if (role === "planner") {
    if (status === TaskStatus.PlanRequested || status === TaskStatus.PlanChangesRequested) {
      return TaskStatus.Planning;
    }
  }
  if (role === "implementer") {
    if (status === TaskStatus.ReadyForCode || status === TaskStatus.ChangesRequested) {
      return TaskStatus.Coding;
    }
    if (status === TaskStatus.Approved) {
      return TaskStatus.Merging;
    }
  }
  if (role === "reviewer") {
    if (status === TaskStatus.CodeReviewRequested) {
      return TaskStatus.Reviewing;
    }
  }
  if (role === "senior" || role === "architect") {
    return getClaimTransition(status, getEffectiveRole(status, role));
  }
  return null;
}

export function getEffectiveRole(status: TaskStatus, compoundRole: string): string {
  if (COMPOUND_ROLES[compoundRole]?.includes("planner")) {
    if (status === TaskStatus.PlanRequested || status === TaskStatus.PlanChangesRequested) {
      return "planner";
    }
  }
  if (COMPOUND_ROLES[compoundRole]?.includes("implementer")) {
    if (
      status === TaskStatus.ReadyForCode ||
      status === TaskStatus.ChangesRequested ||
      status === TaskStatus.Approved
    ) {
      return "implementer";
    }
  }
  if (COMPOUND_ROLES[compoundRole]?.includes("reviewer")) {
    if (status === TaskStatus.CodeReviewRequested) {
      return "reviewer";
    }
  }
  return compoundRole;
}

export function recordHistory(task: Task, newStatus: TaskStatus): Task {
  const now = new Date().toISOString();
  const history = [
    ...task.history,
    { pre_status: task.status, new_status: newStatus, timestamp: now },
  ];
  return updateTask(task.id, { status: newStatus, history })!;
}

export function addConversation(
  task: Task,
  authorName: string,
  message: string,
  messageType?: "user" | "agent" | "plan" | "code" | "review" | "merge" | "system",
): Task {
  const now = new Date().toISOString();
  const conversation = [
    ...task.conversation,
    { authorName, timestamp: now, message, messageType: messageType ?? "agent" },
  ];
  return updateTask(task.id, { conversation })!;
}

export function addActivity(taskId: string, eventType: string, actor: string, details?: string) {
  addActivityEvent({ eventType, taskId, actor, details });
}

export function normalizeStatusInput(status: string): TaskStatus | null {
  if (status === "ready for code") return TaskStatus.ReadyForCode;
  const found = Object.values(TaskStatus).find((s) => s === status);
  return found ?? null;
}

export function buildAgentRef(toolName: string, model: string): AgentReference {
  return { name: toolName, tool: toolName, model };
}

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
}

export interface ClaimNextTaskResult {
  task: Task;
  agent: Agent;
  effectiveRole: string;
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

      const assigned = tryAssignTask({
        id: candidate.id,
        fromStatus: candidate.status,
        toStatus: newStatus,
        assignedAgent: buildAgentRef(input.agent.toolName, input.agent.model),
      });
      if (!assigned) continue;

      const agent = createAgent({ ...input.agent, role: effectiveRole });

      let updated = recordHistory(candidate, newStatus);
      updated = addConversation(updated, agent.id, `Claimed task. Transitioning to ${newStatus}.`);
      updated = appendContext(updated, input.context);

      return { task: getTaskById(updated.id)!, agent, effectiveRole };
    }
    return null;
  });
}

export function releaseTask(
  taskId: string,
  patch?: Omit<Parameters<typeof updateTask>[1], "assignedAgent">,
): Task | null {
  return updateTask(taskId, { ...patch, assignedAgent: null });
}

/** Active statuses (an agent holds the task) and where a revert lands if history is unusable. */
export const REVERT_FALLBACK: Partial<Record<TaskStatus, TaskStatus>> = {
  [TaskStatus.Planning]: TaskStatus.PlanRequested,
  [TaskStatus.Coding]: TaskStatus.ReadyForCode,
  [TaskStatus.Reviewing]: TaskStatus.CodeReviewRequested,
  [TaskStatus.Merging]: TaskStatus.Approved,
};

const CLAIMABLE_FROM: Partial<Record<TaskStatus, TaskStatus[]>> = {
  [TaskStatus.Planning]: [TaskStatus.PlanRequested, TaskStatus.PlanChangesRequested],
  [TaskStatus.Coding]: [TaskStatus.ReadyForCode, TaskStatus.ChangesRequested],
  [TaskStatus.Reviewing]: [TaskStatus.CodeReviewRequested],
  [TaskStatus.Merging]: [TaskStatus.Approved],
};

/**
 * Releases a task whose agent went away without submitting (e.g. the runner's
 * child process exited). The task returns to the status it was claimed from
 * (the last history entry's pre_status when it is a valid origin, otherwise a
 * per-status fallback). Returns null when the task is not in an active status
 * any more, i.e. the agent already submitted or the user intervened.
 */
export function revertClaim(taskId: string, reason: string): Task | null {
  return withTransaction(() => {
    const task = getTaskById(taskId);
    if (!task) return null;
    const fallback = REVERT_FALLBACK[task.status];
    if (!fallback) return null;

    const last = task.history[task.history.length - 1];
    const valid = CLAIMABLE_FROM[task.status] ?? [];
    const target =
      last && last.new_status === task.status && valid.includes(last.pre_status as TaskStatus)
        ? (last.pre_status as TaskStatus)
        : fallback;

    let updated = recordHistory(task, target);
    updated = releaseTask(updated.id)!;
    updated = addConversation(updated, "system", reason, "system");
    addActivity(taskId, "task_reverted", "runner", reason);
    return getTaskById(updated.id);
  });
}

export function appendContext(task: Task, context?: string): Task {
  const entry = context?.trim();
  if (!entry) return task;
  return updateTask(task.id, { contexts: [...(task.contexts || []), entry] })!;
}

// ─── Agent submissions (used by the MCP server) ────────────────────────

/** Thrown when a submission is not allowed in the task's current state. */
export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export interface SubmitInput {
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

const STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  [TaskStatus.Planning]: "Planning",
  [TaskStatus.Coding]: "Coding",
  [TaskStatus.Reviewing]: "Reviewing",
  [TaskStatus.Merging]: "Merging",
};

export function requireTaskInStatus(taskId: string, status: TaskStatus): Task {
  const task = getTaskById(taskId);
  if (!task) {
    throw new WorkflowError("Task not found.");
  }
  if (task.status !== status) {
    throw new WorkflowError(`Task must be in ${STATUS_LABELS[status] ?? status} status.`);
  }
  return task;
}

export function submitPlan(taskId: string, input: SubmitInput = {}): SubmitResult {
  const task = requireTaskInStatus(taskId, TaskStatus.Planning);
  const previousStatus = task.status;
  let updated = recordHistory(task, TaskStatus.WaitingPlanReview);
  if (input.message) {
    updated = addConversation(updated, input.author ?? "agent", input.message, "plan");
  }
  updated = appendContext(updated, input.context);
  updated = releaseTask(updated.id)!;
  addActivity(taskId, "plan_submitted", input.author ?? "agent");
  return {
    task: updated,
    previousStatus,
    newStatus: updated.status,
    message: "Plan submitted. Task moved to Waiting Plan Review.",
  };
}

export function submitCode(taskId: string, input: SubmitCodeInput = {}): SubmitResult {
  const task = requireTaskInStatus(taskId, TaskStatus.Coding);
  const previousStatus = task.status;
  let updated = recordHistory(task, TaskStatus.WaitingCodeReview);
  if (input.message) {
    updated = addConversation(updated, input.author ?? "agent", input.message, "code");
  }
  updated = appendContext(updated, input.context);
  updated = releaseTask(updated.id, { worktreePath: input.worktree ?? null })!;
  addActivity(taskId, "code_submitted", input.author ?? "agent");
  return {
    task: updated,
    previousStatus,
    newStatus: updated.status,
    message: "Code submitted. Task moved to Waiting Code Review.",
  };
}

export function submitReview(taskId: string, input: SubmitInput = {}): SubmitResult {
  const task = requireTaskInStatus(taskId, TaskStatus.Reviewing);
  const previousStatus = task.status;
  let updated = recordHistory(task, TaskStatus.WaitingCodeReview);
  if (input.message) {
    updated = addConversation(updated, input.author ?? "agent", input.message, "review");
  }
  updated = appendContext(updated, input.context);
  updated = releaseTask(updated.id)!;
  addActivity(taskId, "review_submitted", input.author ?? "agent");
  return {
    task: updated,
    previousStatus,
    newStatus: updated.status,
    message: "Review submitted. Task moved to Waiting Code Review.",
  };
}

export function submitMerge(taskId: string, input: SubmitMergeInput): SubmitResult {
  const task = requireTaskInStatus(taskId, TaskStatus.Merging);

  const mergeDetails = [
    `Branch: ${input.branch}`,
    `Commit: ${input.commit}`,
    `Authors: ${input.authors}`,
    input.worktree ? `Worktree: ${input.worktree}` : null,
    input.message ? `Message: ${input.message}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const previousStatus = task.status;
  let updated = recordHistory(task, TaskStatus.Merged);
  updated = addConversation(updated, input.author ?? "agent", `Merge submitted. ${mergeDetails}`, "merge");
  updated = appendContext(updated, input.context);
  updated = releaseTask(updated.id)!;
  addActivity(taskId, "merge_submitted", input.author ?? "agent", mergeDetails);
  return {
    task: updated,
    previousStatus,
    newStatus: updated.status,
    message: "Merge submitted. Task moved to Merged.",
  };
}

export function postComment(taskId: string, input: { message: string; author?: string }): Task {
  const task = getTaskById(taskId);
  if (!task) {
    throw new WorkflowError("Task not found.");
  }
  const author = input.author ?? "agent";
  const updated = addConversation(task, author, input.message, "agent");
  addActivity(task.id, "comment_added", author, input.message);
  return updated;
}
