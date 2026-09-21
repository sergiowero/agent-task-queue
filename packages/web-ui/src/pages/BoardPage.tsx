import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import { TaskCard } from "../components/TaskCard";
import { CreateTaskModal } from "../components/CreateTaskModal";
import { DeleteTaskModal } from "../components/DeleteTaskModal";
import { BulkDeleteModal } from "../components/BulkDeleteModal";
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
  const [deletingTask, setDeletingTask] = useState<any>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
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

  const canEdit = (colKey: string) => colKey === "pending" || colKey === "need-review";

  function toggleSelect(taskId: string) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function toggleColumn(colKey: string) {
    const colTasks = grouped[colKey] ?? [];
    if (colTasks.length === 0) return;
    const allSelected = colTasks.every((t: any) => selectedTaskIds.has(t.id));
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      for (const t of colTasks) {
        if (allSelected) {
          next.delete(t.id);
        } else {
          next.add(t.id);
        }
      }
      return next;
    });
  }

  const columnAllSelected = (colKey: string) => {
    const colTasks = grouped[colKey] ?? [];
    return colTasks.length > 0 && colTasks.every((t: any) => selectedTaskIds.has(t.id));
  };

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

      {selectedTaskIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-surface border-b border-border shrink-0 text-sm">
          <span className="text-text font-medium">{selectedTaskIds.size} selected</span>
          <div className="flex-1" />
          <button
            onClick={() => setSelectedTaskIds(new Set())}
            className="text-text-secondary hover:text-text transition-colors"
          >
            Clear
          </button>
          <button
            onClick={() => setShowBulkDeleteModal(true)}
            className="bg-danger text-white px-3 py-1.5 rounded-lg text-sm hover:bg-danger-hover transition-colors"
          >
            Delete selected
          </button>
        </div>
      )}

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
              <div className="flex items-center gap-2 px-2 py-2">
                {canEdit(col.key) && (grouped[col.key]?.length > 0) && (
                  <input
                    type="checkbox"
                    checked={columnAllSelected(col.key)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleColumn(col.key)}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    title={columnAllSelected(col.key) ? "Deselect all tasks in column" : "Select all tasks in column"}
                  />
                )}
                <h3 className="font-semibold text-sm text-text">{col.label}</h3>
                <span className="text-xs text-text-muted bg-surface-secondary px-1.5 py-0.5 rounded-full">{grouped[col.key]?.length ?? 0}</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 px-1">
                {(grouped[col.key] ?? []).map((task: any) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => navigate(`/tasks/${task.id}/details`)}
                    onDelete={canEdit(col.key) ? () => setDeletingTask(task) : undefined}
                    selected={selectedTaskIds.has(task.id)}
                    onToggleSelect={canEdit(col.key) ? () => toggleSelect(task.id) : undefined}
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

      {deletingTask && (
        <DeleteTaskModal
          task={deletingTask}
          onClose={() => setDeletingTask(null)}
        />
      )}

      {showBulkDeleteModal && (
        <BulkDeleteModal
          taskIds={[...selectedTaskIds]}
          onClose={() => setShowBulkDeleteModal(false)}
          onDeleted={() => setSelectedTaskIds(new Set())}
        />
      )}
    </div>
  );
}
