import type {
  Role,
  AutonomyLevel,
  FindingStatus,
  Phase,
  Risk,
  Severity,
  TaskType,
  Verdict,
} from "@agentq/shared/catalog";
import type { AcceptanceCriterion } from "@agentq/shared/criteria";
import type { ProjectProfile } from "@agentq/shared/profile";

export type { AcceptanceCriterion, ProjectProfile };

export interface Task {
  id: string;
  title: string;
  description: string | null;
  steerDetails: string | null;
  guardrails: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  priority: number;
  recommendedBranch: string;
  realBranch: string | null;
  requiresPlan: boolean;
  mergeBranch: string;
  status: string;
  assignedAgent: { name: string; tool: string; model: string } | null;
  conversation: ConversationEntry[];
  history: StatusHistoryEntry[];
  contexts: string[];
  projectId: string | null;
  worktreePath: string | null;
  /** Set while the task waits for a person in `needs_human`. */
  blocker: Blocker | null;
  /** Consecutive agent runs that ended without a submit. */
  revertStreak: number;
  type: TaskType;
  risk: Risk;
  /** Overrides the project's autonomy level; null uses the project's. */
  autonomy: AutonomyLevel | null;
  planRound: number;
  /** AI code reviews so far. */
  codeRound: number;
  verifyFailures: number;
  lastReview: { round: number; verdict: Verdict; by: string; at: string } | null;
  validationPlan: ValidationPlan | null;
  approvedPlan: { markdown: string; validation: ValidationPlan | null; approvedBy: string; at: string } | null;
  headSha: string | null;
  diffStats: { files: number; insertions: number; deletions: number } | null;
  verification: {
    round: number;
    passed: boolean;
    skipped: boolean;
    note: string | null;
    tampering: string[];
    tamperStrikes: number;
    verifiedSha: string | null;
    at: string;
  } | null;
  riskReasons: string[];
  nonGoals: string[];
  references: { label: string; target: string }[];
  /** Definition-of-Ready problems found when the task was created or edited. */
  dorIssues: string[];
  parentId: string | null;
  blockedBy: string[];
  planSubmission: {
    openQuestions: { text: string; blocking: boolean }[];
    suggestedRisk: Risk | null;
    proposedSubtasks: string[];
    touchedPaths: string[];
  } | null;
  /** A subtask waiting for its parent's plan to be approved. */
  held: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Set once the task was written to its project's archive/ folder (it then leaves the board). */
  archivedAt: string | null;
  /** Absolute path of the archive summary file; the detailed record sits next to it. */
  archivePath: string | null;
  /** The task's pull request, once the agent with the `pr` role opened it (kept in step with GitHub). */
  pullRequest: PullRequest | null;
}

export interface PullRequest {
  url: string | null;
  number: number | null;
  state: "open" | "merged" | "closed";
  branch: string | null;
  mergedAt: string | null;
  mergedBy: string | null;
  /** GitHub users whose latest review asks for changes. */
  changesRequestedBy: string[];
  checks: "pending" | "success" | "failure" | null;
  checkedAt: string | null;
}

/** Response of `GET /metrics`: how much of the flow runs without a person. */
export interface FlowMetrics {
  tasks: number;
  humanClicksPerTask: number;
  reachedPrWithoutHuman: number;
  reviewRoundsAtPr: number;
  escalationRate: number;
  humanRejectionAfterAiApproval: number;
  revertsPerTask: number;
  leadTimeHours: number | null;
  completed: number;
  reachedPr: number;
}

export interface Blocker {
  reason: string;
  question: string;
  phase: Phase | null;
  fromStatus: string;
  raisedBy: string;
  at: string;
}

export interface PolicySettings {
  maxPlanRounds: number;
  maxReviewRounds: number;
  maxVerifyFailures: number;
  requireDifferentModel: boolean;
  humanSampleEvery: number;
  reviewStarvationMin: number;
  leaseMin: number;
  autoMerge: boolean;
}

export interface Finding {
  id: string;
  round: number;
  phase: "plan" | "code";
  severity: Severity;
  file: string | null;
  line: number | null;
  text: string;
  status: FindingStatus;
  resolution: string | null;
  raisedBy: string;
  reopenCount: number;
  createdAt: string;
}

export interface ValidationPlan {
  items: { criterionId: string; how: string; command?: string; newTests?: string[] }[];
  regressionCommands: string[];
}

export interface Evidence {
  id: string;
  round: number;
  kind: "command" | "manual";
  criterionId: string | null;
  command: string | null;
  exitCode: number | null;
  summary: string;
  logPath: string | null;
  producedBy: string;
  flaky: boolean;
  skipped: boolean;
  createdAt: string;
}

export interface Handoff {
  id: number;
  phase: string;
  round: number;
  agentId: string;
  summary: string;
  decisions: string[];
  risks: string[];
  next: string[];
  createdAt: string;
}

/** Response of `GET /tasks/:id/details`: records kept beside the task. */
export interface TaskDetails {
  findings: Finding[];
  evidence: Evidence[];
  handoffs: Handoff[];
  subtasks: { id: string; title: string; status: string; held: boolean; blockedBy: string[] }[];
}

/** Response of `GET /meta`. */
export interface Meta {
  skillsVersion: string | null;
  installedSkills: Record<string, string | null>;
  outdatedSkills: string[];
  verifier?: { online: boolean; running: boolean; busy: boolean; currentTaskId: string | null; lastRunAt: string | null };
  /** GitHub sync of open PRs: unavailable without the `gh` CLI. */
  prSync?: { available: boolean; lastRunAt: string | null; errors: { taskId: string; error: string }[] };
}

/** What the portal sends when it edits a project: partial profile and policy. */
export type ProjectWrite = Omit<Partial<Project>, "profile"> & { profile?: Partial<ProjectProfile> };

/** What the portal sends when it creates or edits a task: criteria as one-line strings. */
export type TaskWrite = Omit<Partial<Task>, "acceptanceCriteria"> & { acceptanceCriteria?: string[]; draft?: boolean };

/** Response of `POST /tasks/:id/archive`. */
export interface ArchiveResult {
  task: Task;
  directory: string;
  summaryPath: string;
  detailedPath: string;
  pullRequests: string[];
}

export interface ConversationEntry {
  authorName: string;
  timestamp: string;
  message: string;
  messageType?: string;
}

export interface StatusHistoryEntry {
  pre_status: string;
  new_status: string;
  timestamp: string;
  /** "user", an agent id, "runner" or "system" (absent on old entries). */
  actor?: string;
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
  /** Branch new tasks merge into unless they name one. */
  defaultMergeBranch: string | null;
  autonomy: AutonomyLevel;
  policy: Partial<PolicySettings>;
  profile: ProjectProfile;
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

export type RunnerTool = "claude" | "codex" | "opencode" | "gemini" | "custom";
export type RunnerPermissionMode = "safe" | "full";
export type RunnerJobStatus = "running" | "succeeded" | "failed" | "reverted" | "blocked";

export interface RunnerJob {
  id: string;
  runnerId: string;
  taskId: string;
  taskTitle: string;
  phase: "plan" | "code" | "review" | "merge";
  pid: number | null;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  status: RunnerJobStatus;
  logPath: string;
}

export interface RunnerState {
  id: string;
  running: boolean;
  activeJobs: number;
  lastError: string | null;
  lastJob: RunnerJob | null;
  jobCount: number;
}

export interface Runner {
  id: string;
  name: string;
  tool: RunnerTool;
  roles: Role[];
  projectId: string | null;
  model: string | null;
  effort: string | null;
  concurrency: number;
  pollIntervalSec: number;
  permissionMode: RunnerPermissionMode;
  extraArgs: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  state: RunnerState;
}

export interface RunnerInput {
  name: string;
  tool: RunnerTool;
  roles: Role[];
  projectId?: string | null;
  model?: string | null;
  effort?: string | null;
  concurrency?: number;
  pollIntervalSec?: number;
  permissionMode?: RunnerPermissionMode;
  extraArgs?: string[] | null;
  enabled?: boolean;
}

export interface ToolInfo {
  tool: RunnerTool;
  installed: boolean;
  version: string | null;
}

export interface ModelOption {
  id: string;
  label: string;
  /** Provider (opencode) or a short blurb; used to group the select. */
  description?: string;
  efforts?: string[];
  defaultEffort?: string;
}

export interface ModelDiscovery {
  tool: RunnerTool;
  source: "cli" | "cache" | "static";
  models: ModelOption[];
  /** null when the tool has no effort flag. */
  efforts: string[] | null;
  defaultEffort?: string | null;
}

/** Payload of the `runner_job` SSE event. */
export type RunnerJobEvent =
  | { type: "started" | "finished"; runnerId: string; jobId: string; job: RunnerJob }
  | { type: "output"; runnerId: string; jobId: string; taskId: string; chunk: string };

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const API_BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getTasks: (projectId?: string) =>
    request<PaginatedResponse<Task>>(projectId ? `/tasks?projectId=${projectId}` : "/tasks"),
  /** Every task, page by page (the list endpoint returns at most 100 at a time). */
  getAllTasks: async (projectId?: string) => {
    const all: Task[] = [];
    for (let offset = 0; ; offset += 100) {
      const params = new URLSearchParams({ limit: "100", offset: String(offset) });
      if (projectId) params.set("projectId", projectId);
      const page = await request<PaginatedResponse<Task>>(`/tasks?${params}`);
      all.push(...page.data);
      if (!page.hasMore || page.data.length === 0) return all;
    }
  },
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (data: TaskWrite) => request<Task>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: string, data: TaskWrite) =>
    request<Task>(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}?hard=true`, { method: "DELETE" }),

  submitPlan: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/submit-plan`, { method: "POST", body: JSON.stringify(data) }),
  submitCode: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/submit-code`, { method: "POST", body: JSON.stringify(data) }),
  submitReview: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/submit-review`, { method: "POST", body: JSON.stringify(data) }),
  submitPr: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/submit-pr`, { method: "POST", body: JSON.stringify(data) }),
  approvePlan: (id: string) => request<Task>(`/tasks/${id}/approve-plan`, { method: "POST" }),
  requestPlanChanges: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/request-plan-changes`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  approveCode: (id: string) => request<Task>(`/tasks/${id}/approve-code`, { method: "POST" }),
  requestCodeChanges: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/request-code-changes`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  requestAiReview: (id: string) =>
    request<Task>(`/tasks/${id}/request-ai-review`, { method: "POST" }),
  confirmCompletion: (id: string) =>
    request<Task>(`/tasks/${id}/confirm-completion`, { method: "POST" }),
  cancel: (id: string) => request<Task>(`/tasks/${id}/cancel`, { method: "POST" }),
  archiveTask: (id: string, data: { force?: boolean } = {}) =>
    request<ArchiveResult>(`/tasks/${id}/archive`, { method: "POST", body: JSON.stringify(data) }),
  unblock: (id: string) => request<Task>(`/tasks/${id}/unblock`, { method: "POST" }),
  promoteDraft: (id: string) => request<Task>(`/tasks/${id}/promote-draft`, { method: "POST" }),
  resolveBlocker: (id: string, data: { answer: string; targetStatus: string }) =>
    request<Task>(`/tasks/${id}/resolve-blocker`, { method: "POST", body: JSON.stringify(data) }),
  getMeta: () => request<Meta>("/meta"),
  getTaskDetails: (id: string) => request<TaskDetails>(`/tasks/${id}/details`),
  detectCommands: (projectId: string) =>
    request<{ commands: ProjectProfile["commands"] }>(`/projects/${projectId}/detect-commands`),
  addComment: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/add-comment`, { method: "POST", body: JSON.stringify(data) }),

  getAgents: (filters?: { role?: string; tool?: string }) => {
    const params = new URLSearchParams();
    if (filters?.role) params.set("role", filters.role);
    if (filters?.tool) params.set("tool", filters.tool);
    const qs = params.toString();
    return request<PaginatedResponse<Agent>>(`/agents${qs ? `?${qs}` : ""}`);
  },

  getProjects: () => request<Project[]>("/projects"),
  createProject: (data: Partial<Project>) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: ProjectWrite) =>
    request<Project>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),

  getActivity: (filters?: {
    taskId?: string;
    agentId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.taskId) params.set("taskId", filters.taskId);
    if (filters?.agentId) params.set("agentId", filters.agentId);
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return request<PaginatedResponse<ActivityEvent>>(`/activity${qs ? `?${qs}` : ""}`);
  },
  getMetrics: (filters?: { projectId?: string; from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    const qs = params.toString();
    return request<FlowMetrics>(`/metrics${qs ? `?${qs}` : ""}`);
  },

  getRunners: () => request<Runner[]>("/runners"),
  getRunnerTools: () => request<ToolInfo[]>("/runners/tools"),
  getRunnerModels: (tool: RunnerTool, refresh = false) =>
    request<ModelDiscovery>(`/runners/tools/${tool}/models${refresh ? "?refresh=1" : ""}`),
  createRunner: (data: RunnerInput) =>
    request<Runner>("/runners", { method: "POST", body: JSON.stringify(data) }),
  updateRunner: (id: string, data: Partial<RunnerInput>) =>
    request<Runner>(`/runners/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRunner: (id: string) => request<void>(`/runners/${id}`, { method: "DELETE" }),
  startRunner: (id: string) => request<Runner>(`/runners/${id}/start`, { method: "POST" }),
  stopRunner: (id: string) => request<Runner>(`/runners/${id}/stop`, { method: "POST" }),
  getRunnerJobs: (id: string) => request<RunnerJob[]>(`/runners/${id}/jobs`),
  getRunnerJobLog: async (runnerId: string, jobId: string, tail = 200) => {
    const res = await fetch(`${API_BASE}/runners/${runnerId}/jobs/${jobId}/log?tail=${tail}`);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.text();
  },
};
