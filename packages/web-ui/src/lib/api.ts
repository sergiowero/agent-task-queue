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
  status: string;
  assignedAgent: { name: string; tool: string; model: string } | null;
  conversation: ConversationEntry[];
  history: StatusHistoryEntry[];
  contexts: string[];
  projectId: string | null;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (data: Partial<Task>) => request<Task>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: string, data: Partial<Task>) =>
    request<Task>(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  submitPlan: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/submit-plan`, { method: "POST", body: JSON.stringify(data) }),
  submitCode: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/submit-code`, { method: "POST", body: JSON.stringify(data) }),
  submitReview: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/submit-review`, { method: "POST", body: JSON.stringify(data) }),
  submitMerge: (id: string, data: any) =>
    request<Task>(`/tasks/${id}/submit-merge`, { method: "POST", body: JSON.stringify(data) }),
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
  unblock: (id: string) => request<Task>(`/tasks/${id}/unblock`, { method: "POST" }),
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
  updateProject: (id: string, data: Partial<Project>) =>
    request<Project>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),

  getActivity: (filters?: {
    taskId?: string;
    agentId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.taskId) params.set("taskId", filters.taskId);
    if (filters?.agentId) params.set("agentId", filters.agentId);
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return request<PaginatedResponse<ActivityEvent>>(`/activity${qs ? `?${qs}` : ""}`);
  },

};
