import type { TaskStatus} from "./catalog.js";
import { type Phase } from "./catalog.js";

export { TaskStatus, normalizeStatus } from "./catalog.js";

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
  /** Who made the change: "user", an agent id, "runner" or "system". Absent on old entries. */
  actor?: string;
}

export interface AgentReference {
  name: string;
  tool: string;
  model: string;
  /** Agent row id (`tool@version|model`) of the claim. */
  agentId?: string;
  /**
   * Stable identity used for separation of duties: `runner:<runnerId>` for
   * runner claims, `session:<sessionId>` for agents that claimed through MCP.
   */
  sessionKey?: string;
  runnerId?: string;
  claimedAt?: string;
}

/** Why an agent (or the runner) stopped and what it needs from a person. */
export interface Blocker {
  reason: string;
  question: string;
  /** Phase the task was blocked in; decides where a person may send it next. */
  phase: Phase | null;
  /** Status the task was in when it was blocked. */
  fromStatus: TaskStatus;
  raisedBy: string;
  at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  steerDetails: string | null;
  guardrails: string[];
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
  /**
   * Secret handed to the agent that holds the claim; submits must present it.
   * Null when nobody holds the task (and on claims made before it existed).
   */
  claimToken: string | null;
  /** Set while the task is in `needs_human`. */
  blocker: Blocker | null;
  /** Consecutive runs that ended without a submit; reset by any submit or human action. */
  revertStreak: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Set once the task was written to the project's archive/ folder; archived tasks leave the board. */
  archivedAt: string | null;
  /** Absolute path of the archive summary file (the detailed file sits next to it). */
  archivePath: string | null;
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
  deletedAt: string | null;
}

export interface Project {
  id: string;
  displayName: string;
  workingDirectory: string;
  /** Branch new tasks merge into (detected from origin/HEAD when the project is created). */
  defaultMergeBranch: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ActivityEvent {
  id: number;
  eventType: string;
  taskId: string;
  actor: string | null;
  details: string | null;
  createdAt: string;
}

export type RunnerTool = "claude" | "codex" | "opencode" | "gemini" | "custom";
export type RunnerPermissionMode = "safe" | "full";

export interface Runner {
  id: string;
  name: string;
  tool: RunnerTool;
  role: string;
  projectId: string | null;
  model: string | null;
  /** Reasoning effort passed to tools that support it (claude, codex, opencode). */
  effort: string | null;
  concurrency: number;
  pollIntervalSec: number;
  permissionMode: RunnerPermissionMode;
  extraArgs: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
