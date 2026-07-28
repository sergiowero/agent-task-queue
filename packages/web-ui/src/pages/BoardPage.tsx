import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import { TaskCard } from "../components/TaskCard";
import { CreateTaskModal } from "../components/CreateTaskModal";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { EmptyState } from "../components/EmptyState";
import type { Task } from "../lib/api";

const STATUS_LABELS: Record<string, string> = {
  plan_requested: "Plan Requested",
  planning: "Planning",
  ready_for_code: "Ready for Code",
  coding: "Coding",
  waiting_plan_review: "Waiting Plan Review",
  waiting_code_review: "Waiting Code Review",
  code_review_requested: "Code Review Requested",
  reviewing: "Reviewing",
  changes_requested: "Changes Requested",
  plan_changes_requested: "Plan Changes Requested",
  approved: "Approved",
  merging: "Merging",
  merged: "Merged",
  complete: "Complete",
  canceled: "Canceled",
};

const COLUMNS = [
  {
    key: "pending",
    label: "Pending",
    statuses: [
      "plan_requested",
      "ready_for_code",
      "plan_changes_requested",
      "code_review_requested",
      "changes_requested",
      "approved",
    ],
  },
  {
    key: "in-progress",
    label: "In Progress",
    statuses: ["planning", "coding", "reviewing", "merging"],
  },
  {
    key: "need-review",
    label: "Need Review",
    statuses: ["waiting_plan_review", "waiting_code_review"],
  },
  { key: "done", label: "Done", statuses: ["complete", "merged"] },
];

const COLUMN_COLORS: Record<string, string> = {
  pending: "border-gray-300 dark:border-gray-600",
  "in-progress": "border-blue-400",
  "need-review": "border-yellow-400",
  done: "border-green-400",
};

export function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = searchParams.get("projectId") ?? undefined;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.getTasks(projectId),
  });

  const tasks: Task[] = tasksData?.data ?? [];

  const onSSEMessage = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }, [queryClient]);

  useSSE(onSSEMessage, queryClient);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !t.title.toLowerCase().includes(q) &&
          !(t.recommendedBranch ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (statusFilter && t.status !== statusFilter) return false;
      if (agentFilter && t.assignedAgent?.name !== agentFilter) return false;
      return true;
    });
  }, [tasks, search, statusFilter, agentFilter]);

  const grouped = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const col of COLUMNS) {
      map[col.key] = filteredTasks
        .filter((t) => col.statuses.includes(t.status))
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
    }
    return map;
  }, [filteredTasks]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <input
          className="border border-border bg-surface-secondary text-text placeholder:text-text-muted rounded px-3 py-1.5 text-sm w-64"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border border-border bg-surface-secondary text-text rounded px-2 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {[...new Set(tasks.map((t) => t.status))].map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select
          className="border border-border bg-surface-secondary text-text rounded px-2 py-1.5 text-sm"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">All agents</option>
          {[...new Set(tasks.map((t) => t.assignedAgent?.name).filter(Boolean))].map(
            (a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ),
          )}
        </select>
        <select
          className="border border-border bg-surface-secondary text-text rounded px-2 py-1.5 text-sm"
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
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-500"
        >
          New Task
        </button>
      </div>

      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {isLoading ? (
          <div className="flex-1 grid grid-cols-4 gap-4">
            {COLUMNS.map((col) => (
              <div key={col.key} className="min-w-[280px]">
                <LoadingSkeleton count={3} />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              title="No tasks yet"
              description="Create your first task to get started."
            />
          </div>
        ) : (
          COLUMNS.filter((col) => !hiddenColumns.has(col.key)).map((col) => (
            <div
              key={col.key}
              className={`flex-1 min-w-[280px] flex flex-col border-t-2 ${COLUMN_COLORS[col.key]}`}
            >
              <div className="flex items-center justify-between px-2 py-2">
                <h3 className="font-medium text-sm text-text">{col.label}</h3>
                <span className="text-xs text-text-muted">{grouped[col.key]?.length ?? 0}</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 px-1">
                {(grouped[col.key] ?? []).length === 0 ? (
                  <p className="text-xs text-text-muted text-center py-4">No tasks</p>
                ) : (
                  (grouped[col.key] ?? []).map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={() => navigate(`/tasks/${task.id}/details`)}
                    />
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <CreateTaskModal projectId={projectId} onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}
