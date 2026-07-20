import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import { TaskCard } from "../components/TaskCard";
import { TaskDrawer } from "../components/TaskDrawer";
import { CreateTaskModal } from "../components/CreateTaskModal";

const COLUMNS = [
  { key: "pending", label: "Pending", statuses: ["new", "ready", "plan_changes_requested", "code_review_requested", "changes_requested", "approved"] },
  { key: "in-progress", label: "In Progress", statuses: ["planning", "coding", "reviewing", "merging"] },
  { key: "need-review", label: "Need Review", statuses: ["waiting_plan_review", "waiting_code_review"] },
  { key: "done", label: "Done", statuses: ["complete", "merged"] },
];

const COLUMN_COLORS: Record<string, string> = {
  "pending": "border-gray-300",
  "in-progress": "border-blue-400",
  "need-review": "border-yellow-400",
  "done": "border-green-400",
};

export function BoardPage() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("projectId") ?? undefined;
  const taskIdFromUrl = window.location.pathname.match(/\/tasks\/(.+)/)?.[1];
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(taskIdFromUrl ?? null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");

  const { data: tasks = [], refetch } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.getTasks(projectId),
  });

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
      {/* Top Bar */}
      <div className="h-14 border-b border-gray-200 bg-white flex items-center px-4 gap-4 shrink-0">
        <input
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {[...new Set(tasks.map((t: any) => t.status))].map((s: any) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">All agents</option>
          {[...new Set(tasks.map((t: any) => t.assignedAgent?.name).filter(Boolean))].map((a: any) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => refetch()}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          Refresh
        </button>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-500"
        >
          New Task
        </button>
        <button
          onClick={() => {
            const settings = prompt("Hidden columns (comma-separated: pending,in-progress,need-review,done):", [...hiddenColumns].join(","));
            if (settings !== null) {
              setHiddenColumns(new Set(settings.split(",").map(s => s.trim()).filter(Boolean)));
            }
          }}
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          Settings
        </button>
      </div>

      {/* Board */}
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {COLUMNS.filter((col) => !hiddenColumns.has(col.key)).map((col) => (
          <div key={col.key} className={`flex-1 min-w-[280px] flex flex-col border-t-2 ${COLUMN_COLORS[col.key]}`}>
            <div className="flex items-center justify-between px-2 py-2">
              <h3 className="font-medium text-sm text-gray-700">{col.label}</h3>
              <span className="text-xs text-gray-400">{grouped[col.key]?.length ?? 0}</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 px-1">
              {(grouped[col.key] ?? []).map((task: any) => (
                <TaskCard key={task.id} task={task} onClick={() => setSelectedTaskId(task.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Task Drawer */}
      {selectedTaskId && (
        <TaskDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateTaskModal
          projectId={projectId}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
