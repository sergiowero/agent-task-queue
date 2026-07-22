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
  // Tasks
  getTasks: (projectId?: string) =>
    request<any[]>(projectId ? `/tasks?projectId=${projectId}` : "/tasks"),
  getTask: (id: string) => request<any>(`/tasks/${id}`),
  createTask: (data: any) =>
    request<any>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: string, data: any) =>
    request<any>(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTask: (id: string) =>
    request<void>(`/tasks/${id}`, { method: "DELETE" }),

  // Workflow transitions
  submitPlan: (id: string, data: any) =>
    request<any>(`/tasks/${id}/submit-plan`, { method: "POST", body: JSON.stringify(data) }),
  submitCode: (id: string, data: any) =>
    request<any>(`/tasks/${id}/submit-code`, { method: "POST", body: JSON.stringify(data) }),
  submitReview: (id: string, data: any) =>
    request<any>(`/tasks/${id}/submit-review`, { method: "POST", body: JSON.stringify(data) }),
  submitMerge: (id: string, data: any) =>
    request<any>(`/tasks/${id}/submit-merge`, { method: "POST", body: JSON.stringify(data) }),
  approvePlan: (id: string) =>
    request<any>(`/tasks/${id}/approve-plan`, { method: "POST" }),
  requestPlanChanges: (id: string, data: any) =>
    request<any>(`/tasks/${id}/request-plan-changes`, { method: "POST", body: JSON.stringify(data) }),
  approveCode: (id: string) =>
    request<any>(`/tasks/${id}/approve-code`, { method: "POST" }),
  requestCodeChanges: (id: string, data: any) =>
    request<any>(`/tasks/${id}/request-code-changes`, { method: "POST", body: JSON.stringify(data) }),
  requestAiReview: (id: string) =>
    request<any>(`/tasks/${id}/request-ai-review`, { method: "POST" }),
  confirmCompletion: (id: string) =>
    request<any>(`/tasks/${id}/confirm-completion`, { method: "POST" }),
  cancel: (id: string) =>
    request<any>(`/tasks/${id}/cancel`, { method: "POST" }),
  unblock: (id: string) =>
    request<any>(`/tasks/${id}/unblock`, { method: "POST" }),

  // Agents
  getAgents: (filters?: { role?: string; tool?: string }) => {
    const params = new URLSearchParams();
    if (filters?.role) params.set("role", filters.role);
    if (filters?.tool) params.set("tool", filters.tool);
    const qs = params.toString();
    return request<any[]>(`/agents${qs ? `?${qs}` : ""}`);
  },

  // Projects
  getProjects: () => request<any[]>("/projects"),
  createProject: (data: any) =>
    request<any>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: any) =>
    request<any>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: "DELETE" }),

  // Activity
  getActivity: (filters?: { taskId?: string; agentId?: string; from?: string; to?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.taskId) params.set("taskId", filters.taskId);
    if (filters?.agentId) params.set("agentId", filters.agentId);
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return request<any[]>(`/activity${qs ? `?${qs}` : ""}`);
  },

  // Tools
  executeInstall: () =>
    fetch(`${API_BASE}/tools/install/execute`, { method: "POST" }),
  executeInstallSkills: () =>
    fetch(`${API_BASE}/tools/install/skills`, { method: "POST" }),
  getSkillFile: () =>
    request<{ content: string }>("/tools/install/skill-file"),
};
