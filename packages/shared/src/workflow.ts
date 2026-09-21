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
    const candidates = getClaimableTasks(claimableStatuses, input.projectId, MAX_CLAIM_ATTEMPTS);
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
      if (input.context) {
        updated = updateTask(updated.id, { contexts: [...(updated.contexts || []), input.context] })!;
      }

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
