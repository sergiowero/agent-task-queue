import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import { TaskCard } from "../components/TaskCard";
import { CreateTaskModal } from "../components/CreateTaskModal";
import { EditTaskModal } from "../components/EditTaskModal";
import { Skeleton } from "../components/Skeleton";

const COLUMNS = [
  { key: "pending", label: "Pending", statuses: ["plan_requested", "ready_for_code", "plan_changes_requested", "code_review_requested", "changes_requested", "approved"] },
  { key: "in-progress", label: "In Progress", statuses: ["planning", "coding", "reviewing", "merging"] },
  { key: "need-review", label: "Need Review", statuses: ["waiting_plan_review", "waiting_code_review"] },
  { key: "done", label: "Done", statuses: ["complete", "merged"] },
];

const COLUMN_COLORS: Record<string, string> = {
  "pending": "border-t-gray-300 dark:border-t-gray-600",
  "in-progress": "border-t-blue-400 dark:border-t-blue-500",
  "need-review": "border-t-yellow-400 dark:border-t-yellow-500",
  "done": "border-t-green-400 dark:border-t-green-500",
};

export function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = searchParams.get("projectId") ?? undefined;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });

  const { data: tasksRes, isLoading } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.getTasks(projectId),
  });
  const tasks = tasksRes?.data ?? [];

  useSSE(useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }, [queryClient]));

  const filteredTasks = useMemo(() => {
    return tasks.filter((t: any) => {
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !(t.recommendedBranch ?? "").toLowerCase().includes(q)) {
          return false;
        }
      }
      if (statusFilter && t.status !== statusFilter) return false;
      if (agentFilter && t.assignedAgent?.name !== agentFilter) return false;
      return true;
    });
  }, [tasks, search, statusFilter, agentFilter]);

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const col of COLUMNS) {
      map[col.key] = filteredTasks
        .filter((t: any) => col.statuses.includes(t.status))
        .sort((a: any, b: any) => b.priority - a.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    return map;
  }, [filteredTasks]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <input
          className="border border-border bg-surface-secondary text-text placeholder:text-text-muted rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all duration-150"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border border-border bg-surface-secondary text-text rounded-lg px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all duration-150"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {[...new Set(tasks.map((t: any) => t.status))].map((s: any) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="border border-border bg-surface-secondary text-text rounded-lg px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all duration-150"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">All agents</option>
          {[...new Set(tasks.map((t: any) => t.assignedAgent?.name).filter(Boolean))].map((a: any) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          className="border border-border bg-surface-secondary text-text rounded-lg px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all duration-150"
          value={projectId ?? ""}
          onChange={(e) => {
            const params = new URLSearchParams(searchParams);
            if (e.target.value) {
              params.set("projectId", e.target.value);
            } else {
              params.delete("projectId");
            }
            setSearchParams(params);
          }}
        >
          <option value="">All projects</option>
          {projects.map((p: any) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary text-white px-3 py-1.5 rounded-lg text-sm hover:bg-primary-hover transition-colors"
        >
          New Task
        </button>
      </div>

      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {isLoading ? (
          <>
            {COLUMNS.map((col) => (
              <div key={col.key} className="flex-1 min-w-[280px]">
                <div className="flex items-center justify-between px-2 py-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-6" />
                </div>
                <div className="space-y-2 px-1">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-surface rounded-xl border border-border p-3 space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : (
          COLUMNS.filter((col) => !hiddenColumns.has(col.key)).map((col) => (
            <div key={col.key} className={`flex-1 min-w-[280px] flex flex-col border-t-2 ${COLUMN_COLORS[col.key]}`}>
              <div className="flex items-center justify-between px-2 py-2">
                <h3 className="font-semibold text-sm text-text">{col.label}</h3>
                <span className="text-xs text-text-muted bg-surface-secondary px-1.5 py-0.5 rounded-full">{grouped[col.key]?.length ?? 0}</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 px-1">
                {(grouped[col.key] ?? []).map((task: any) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => navigate(`/tasks/${task.id}/details`)}
                    onEdit={col.key === "pending" || col.key === "need-review" ? () => setEditingTask(task) : undefined}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <CreateTaskModal
          projectId={projectId}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
