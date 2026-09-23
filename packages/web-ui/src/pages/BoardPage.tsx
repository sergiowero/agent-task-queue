import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useEffect } from "react";
import type { CSSProperties } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Task } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import type { LucideIcon } from "../lib/icons";
import {
  AddIcon,
  AgentsIcon,
  BoardIcon,
  ClearIcon,
  CloseIcon,
  CompleteIcon,
  DeleteIcon,
  FilterIcon,
  InProgressIcon,
  PendingIcon,
  ProjectsIcon,
  ReviewIcon,
  SearchIcon,
} from "../lib/icons";
import type { Tone } from "../lib/status";
import { TASK_STATUS, TONE_SOFT, taskStatusMeta } from "../lib/status";
import { cn } from "../lib/cn";
import { TaskCard } from "../components/TaskCard";
import { CreateTaskModal } from "../components/CreateTaskModal";
import { DeleteTaskModal } from "../components/DeleteTaskModal";
import { ArchiveTaskModal } from "../components/ArchiveTaskModal";
import { BulkDeleteModal } from "../components/BulkDeleteModal";
import { Skeleton } from "../components/Skeleton";
import { PageHeader, CountPill } from "../components/PageHeader";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { Checkbox } from "../components/Checkbox";

interface Column {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: Tone;
  statuses: string[];
}

const COLUMNS: Column[] = [
  {
    key: "pending",
    label: "Pending",
    icon: PendingIcon,
    tone: "neutral",
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
    label: "In progress",
    icon: InProgressIcon,
    tone: "info",
    statuses: ["planning", "coding", "reviewing", "merging"],
  },
  {
    key: "need-review",
    label: "Needs review",
    icon: ReviewIcon,
    tone: "warning",
    statuses: ["waiting_plan_review", "waiting_code_review"],
  },
  {
    key: "done",
    label: "Done",
    icon: CompleteIcon,
    tone: "success",
    statuses: ["complete", "merged"],
  },
];

/** Workflow order for the status filter. */
const STATUS_ORDER = Object.keys(TASK_STATUS);

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** Keeps an element mounted for its exit animation after `open` turns false. */
function usePresence(open: boolean, exitMs = 180) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}

export function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = searchParams.get("projectId") ?? undefined;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [hiddenColumns] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [archivingTask, setArchivingTask] = useState<Task | null>(null);
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
  const tasks = useMemo(() => tasksRes?.data ?? [], [tasksRes]);

  useSSE(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }, [queryClient]),
  );

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

  const statusOptions = useMemo(() => {
    const set = new Set(tasks.map((t) => t.status));
    // Keep the active filter selectable even if no task has that status anymore.
    if (statusFilter) set.add(statusFilter);
    const rank = (s: string) => {
      const i = STATUS_ORDER.indexOf(s);
      return i === -1 ? STATUS_ORDER.length : i;
    };
    return [...set].sort((a, b) => rank(a) - rank(b));
  }, [tasks, statusFilter]);

  const agentOptions = useMemo(() => {
    const set = new Set(
      tasks.map((t) => t.assignedAgent?.name).filter((n): n is string => Boolean(n)),
    );
    if (agentFilter) set.add(agentFilter);
    return [...set];
  }, [tasks, agentFilter]);

  const hasFilters = Boolean(search || statusFilter || agentFilter || projectId);

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setAgentFilter("");
    if (projectId) {
      const params = new URLSearchParams(searchParams);
      params.delete("projectId");
      setSearchParams(params);
    }
  }

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
    const allSelected = colTasks.every((t) => selectedTaskIds.has(t.id));
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

  function columnSelection(colKey: string) {
    const colTasks = grouped[colKey] ?? [];
    const count = colTasks.filter((t) => selectedTaskIds.has(t.id)).length;
    return { all: colTasks.length > 0 && count === colTasks.length, some: count > 0 };
  }

  // The floating bar keeps showing the last count while it animates out.
  const selectedCount = selectedTaskIds.size;
  const [barCount, setBarCount] = useState(selectedCount);
  useEffect(() => {
    if (selectedCount > 0) setBarCount(selectedCount);
  }, [selectedCount]);
  const bar = usePresence(selectedCount > 0);

  // Widths live on wrappers: a width passed to `wrapperClassName` competes with the
  // control's own `w-full`, and Tailwind doesn't guarantee which one wins.
  const toolbar = (
    <>
      <div className="w-64 shrink-0">
        <Input
          icon={SearchIcon}
          inputSize="sm"
          placeholder="Search title or branch…"
          aria-label="Search tasks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearch("");
          }}
          trailing={
            search ? (
              <IconButton
                icon={CloseIcon}
                label="Clear search"
                size="xs"
                onClick={() => setSearch("")}
                className="animate-fade-in"
              />
            ) : undefined
          }
        />
      </div>
      <div className="w-48 shrink-0">
        <Select
          selectSize="sm"
          icon={FilterIcon}
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {taskStatusMeta(s).label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-40 shrink-0">
        <Select
          selectSize="sm"
          icon={AgentsIcon}
          aria-label="Filter by agent"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
        >
          <option value="">All agents</option>
          {agentOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-44 shrink-0">
        <Select
          selectSize="sm"
          icon={ProjectsIcon}
          aria-label="Filter by project"
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
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </Select>
      </div>
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          icon={ClearIcon}
          onClick={clearFilters}
          className="animate-fade-in"
        >
          Clear filters
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        icon={BoardIcon}
        title="Board"
        description="Every task in the queue, grouped by where it is in the workflow."
        meta={
          !isLoading && (
            <CountPill>
              {hasFilters ? `${filteredTasks.length} / ${tasks.length}` : tasks.length}
            </CountPill>
          )
        }
        actions={
          <Button icon={AddIcon} onClick={() => setShowCreateModal(true)}>
            New task
          </Button>
        }
        toolbar={toolbar}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            "flex min-h-0 flex-1 gap-4 overflow-x-auto px-6 pt-6 transition-[padding] duration-300 ease-out-expo",
            bar.mounted && !bar.closing ? "pb-24" : "pb-6",
          )}
        >
          {isLoading
            ? COLUMNS.map((col) => (
                <div
                  key={col.key}
                  className="flex min-w-[260px] flex-1 flex-col rounded-2xl border border-border-light bg-surface-secondary/60"
                >
                  <div className="flex h-12 shrink-0 items-center gap-2 px-3.5">
                    <Skeleton className="h-6 w-6 rounded-md" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-6 rounded-full" />
                  </div>
                  <div className="space-y-2 px-2.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="card space-y-3 p-3">
                        <div className="flex items-start gap-2">
                          <Skeleton className="h-4 flex-1" />
                          <Skeleton className="h-4 w-9 rounded-full" />
                        </div>
                        <Skeleton className="h-3 w-2/3" />
                        <Skeleton className="h-5 w-24 rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            : COLUMNS.filter((col) => !hiddenColumns.has(col.key)).map((col, ci) => {
                const colTasks = grouped[col.key] ?? [];
                const editable = canEdit(col.key);
                const selection = columnSelection(col.key);
                const Icon = col.icon;
                return (
                  <section
                    key={col.key}
                    aria-label={col.label}
                    style={stagger(ci)}
                    className="stagger flex min-w-[260px] flex-1 flex-col rounded-2xl border border-border-light bg-surface-secondary/60"
                  >
                    <header className="flex h-12 shrink-0 items-center gap-2 px-3.5">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-md",
                          TONE_SOFT[col.tone],
                        )}
                      >
                        <Icon aria-hidden className="h-3.5 w-3.5" />
                      </span>
                      <h2 className="text-[13px] font-semibold text-text">{col.label}</h2>
                      <CountPill>{colTasks.length}</CountPill>
                      {editable && colTasks.length > 0 && (
                        <Checkbox
                          className="ml-auto"
                          checked={selection.all}
                          indeterminate={selection.some && !selection.all}
                          onChange={() => toggleColumn(col.key)}
                          label={
                            selection.all
                              ? `Deselect all ${col.label.toLowerCase()} tasks`
                              : `Select all ${col.label.toLowerCase()} tasks`
                          }
                        />
                      )}
                    </header>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5 pt-0.5">
                      {colTasks.length === 0 ? (
                        <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-border text-xs text-text-muted animate-fade-in">
                          {hasFilters ? "No matching tasks" : "No tasks"}
                        </div>
                      ) : (
                        colTasks.map((task, i) => (
                          <div key={task.id} className="stagger" style={stagger(i)}>
                            <TaskCard
                              task={task}
                              onClick={() => navigate(`/tasks/${task.id}/details`)}
                              onDelete={editable ? () => setDeletingTask(task) : undefined}
                              onArchive={
                                task.status === "complete"
                                  ? () => setArchivingTask(task)
                                  : undefined
                              }
                              selected={selectedTaskIds.has(task.id)}
                              onToggleSelect={editable ? () => toggleSelect(task.id) : undefined}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
        </div>

        {bar.mounted && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
            <div
              role="toolbar"
              aria-label="Selected tasks"
              className={cn(
                "pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-border bg-surface-elevated py-1.5 pl-4 pr-1.5 shadow-xl",
                bar.closing ? "animate-scale-out" : "animate-scale-in",
              )}
            >
              <span className="text-sm font-medium tabular-nums text-text" aria-live="polite">
                {selectedCount || barCount} selected
              </span>
              <span aria-hidden className="mx-2 h-5 w-px bg-border" />
              <Button
                variant="ghost"
                size="sm"
                icon={ClearIcon}
                onClick={() => setSelectedTaskIds(new Set())}
              >
                Clear
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={DeleteIcon}
                onClick={() => setShowBulkDeleteModal(true)}
                disabled={selectedCount === 0}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateTaskModal projectId={projectId} onClose={() => setShowCreateModal(false)} />
      )}

      {deletingTask && (
        <DeleteTaskModal
          task={deletingTask}
          onClose={() => setDeletingTask(null)}
          onDeleted={() => {
            const id = deletingTask.id;
            setSelectedTaskIds((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }}
        />
      )}

      {archivingTask && (
        <ArchiveTaskModal
          task={archivingTask}
          project={projects.find((p) => p.id === archivingTask.projectId)}
          onClose={() => setArchivingTask(null)}
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
