import { updateTask, addActivityEvent } from "./database.js";
import type { Task } from "./types.js";
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
