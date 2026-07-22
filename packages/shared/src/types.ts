export enum TaskStatus {
  PlanRequested = "plan_requested",
  Planning = "planning",
  WaitingPlanReview = "waiting_plan_review",
  PlanChangesRequested = "plan_changes_requested",
  ReadyForCode = "ready for code",
  Coding = "coding",
  WaitingCodeReview = "waiting_code_review",
  CodeReviewRequested = "code_review_requested",
  Reviewing = "reviewing",
  ChangesRequested = "changes_requested",
  Approved = "approved",
  Merging = "merging",
  Merged = "merged",
  Complete = "complete",
  Canceled = "canceled",
}

export interface ConversationEntry {
  authorName: string;
  timestamp: string;
  message: string;
  messageType?: "user" | "agent" | "plan" | "code" | "review" | "merge" | "system";
}

export interface StatusHistoryEntry {
  pre_status: string;
  new_status: string;
  timestamp: string;
}

export interface AgentReference {
  name: string;
  tool: string;
  model: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string[];
  priority: number;
  recommendedBranch: string;
  realBranch: string | null;
  requiresPlan: boolean;
  mergeBranch: string;
  status: TaskStatus;
  assignedAgent: AgentReference | null;
  conversation: ConversationEntry[];
  history: StatusHistoryEntry[];
  contexts: string[];
  projectId: string | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  toolName: string;
  version: string;
  model: string;
  role: string;
  sessionId: string;
  host: string | null;
  startedAt: string | null;
  lastSeen: string | null;
}

export interface Project {
  id: string;
  displayName: string;
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: number;
  eventType: string;
  taskId: string;
  actor: string | null;
  details: string | null;
  createdAt: string;
}
