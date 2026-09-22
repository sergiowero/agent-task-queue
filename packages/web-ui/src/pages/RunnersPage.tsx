import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Runner, RunnerJob, RunnerJobEvent, RunnerJobStatus } from "../lib/api";
import { api } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { RunnerModal } from "../components/RunnerModal";
import { Skeleton } from "../components/Skeleton";

const JOB_BADGE: Record<RunnerJobStatus, { variant: "info" | "success" | "danger" | "warning"; label: string }> = {
  running: { variant: "info", label: "running" },
  succeeded: { variant: "success", label: "succeeded" },
  failed: { variant: "danger", label: "failed" },
  reverted: { variant: "warning", label: "reverted" },
};

const TOOL_BADGE: Record<string, "purple" | "info" | "success" | "warning" | "default"> = {
  claude: "purple",
  codex: "info",
  opencode: "success",
  gemini: "warning",
  custom: "default",
};

function formatDuration(start: string, end?: string) {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function DeleteRunnerModal({ runner, onClose }: { runner: Runner; onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.deleteRunner(runner.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runners"] });
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-6 transition-colors duration-300">
        <h2 className="text-lg font-semibold mb-2 text-text">Delete Runner</h2>
        <p className="text-sm text-text-secondary mb-4">
          Delete <span className="font-medium text-text">{runner.name}</span>? Running jobs are killed and their tasks
          released back to the queue.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} variant="danger">
            {mutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LogPanel({ runnerId, job }: { runnerId: string; job: RunnerJob }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setText("");
    api
      .getRunnerJobLog(runnerId, job.id, 500)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e: Error) => {
        if (!cancelled) setText(`(could not load log: ${e.message})\n`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runnerId, job.id]);

  useSSE(
    useCallback(
      ({ event, data }) => {
        if (event !== "runner_job") return;
        const ev = data as RunnerJobEvent;
        if (ev.jobId !== job.id) return;
        if (ev.type === "output") {
          setText((prev) => {
            const next = prev + ev.chunk;
            // Keep the panel bounded.
            return next.length > 200_000 ? next.slice(next.length - 200_000) : next;
          });
        }
      },
      [job.id],
    ),
    queryClient,
  );

  useEffect(() => {
    if (follow && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [text, follow]);

  const onScroll = () => {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow(atBottom);
  };

  const badge = JOB_BADGE[job.status];
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs text-text-secondary">
        <Badge variant={badge.variant} dot={job.status === "running"}>
          {badge.label}
        </Badge>
        <span className="font-mono truncate">{job.phase}</span>
        <span>·</span>
        <Link to={`/tasks/${job.taskId}/details`} className="truncate text-primary hover:underline">
          {job.taskTitle}
        </Link>
        <div className="flex-1" />
        {job.pid !== null && <span className="font-mono">pid {job.pid}</span>}
        {job.exitCode !== undefined && job.exitCode !== null && <span className="font-mono">exit {job.exitCode}</span>}
        <span>{formatDuration(job.startedAt, job.finishedAt)}</span>
        {!follow && (
          <button
            className="text-primary hover:underline"
            onClick={() => {
              setFollow(true);
              if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
            }}
          >
            Follow
          </button>
        )}
      </div>
      <pre
        ref={preRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-auto p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words bg-surface-secondary text-text"
      >
        {loading ? "Loading log..." : text || "(no output yet)"}
      </pre>
    </div>
  );
}

function JobsDrawer({ runner, onClose }: { runner: Runner; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["runner-jobs", runner.id],
    queryFn: () => api.getRunnerJobs(runner.id),
    refetchInterval: 5000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep `selected` in sync with the refreshed job list (status, exit code...).
  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;

  useSSE(
    useCallback(
      ({ event, data }) => {
        if (event !== "runner_job") return;
        const ev = data as RunnerJobEvent;
        if (ev.runnerId !== runner.id || ev.type === "output") return;
        queryClient.setQueryData<RunnerJob[]>(["runner-jobs", runner.id], (old) => {
          const list = old ?? [];
          const idx = list.findIndex((j) => j.id === ev.job.id);
          if (idx === -1) return [ev.job, ...list];
          const next = [...list];
          next[idx] = ev.job;
          return next;
        });
        if (ev.type === "started") setSelectedId(ev.job.id);
      },
      [runner.id, queryClient],
    ),
    queryClient,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end animate-fade-in">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-surface border-l border-border shadow-xl flex flex-col h-full">
        <div className="h-14 border-b border-border flex items-center px-4 gap-3 shrink-0">
          <h3 className="font-semibold text-text truncate">{runner.name}</h3>
          <Badge variant={TOOL_BADGE[runner.tool] ?? "default"}>{runner.tool}</Badge>
          <Badge>{runner.role}</Badge>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-secondary" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-72 border-r border-border overflow-auto shrink-0">
            {isLoading && (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}
            {!isLoading && jobs.length === 0 && (
              <p className="p-4 text-sm text-text-muted">No jobs yet. Jobs appear here as soon as the runner claims a task.</p>
            )}
            {jobs.map((job) => {
              const badge = JOB_BADGE[job.status];
              const active = selected?.id === job.id;
              return (
                <button
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-border transition-colors ${
                    active ? "bg-primary/10" : "hover:bg-surface-secondary"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={badge.variant} dot={job.status === "running"}>
                      {badge.label}
                    </Badge>
                    <span className="text-xs text-text-muted font-mono">{job.phase}</span>
                    <span className="flex-1" />
                    <span className="text-xs text-text-muted">{formatDuration(job.startedAt, job.finishedAt)}</span>
                  </div>
                  <div className="text-sm text-text truncate mt-1">{job.taskTitle}</div>
                  <div className="text-xs text-text-muted">{new Date(job.startedAt).toLocaleTimeString()}</div>
                </button>
              );
            })}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            {selected ? (
              <LogPanel key={selected.id} runnerId={runner.id} job={selected} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-text-muted">Select a job to see its output.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunnerCard({
  runner,
  projectName,
  onOpen,
  onEdit,
  onDelete,
}: {
  runner: Runner;
  projectName: string | null;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => (runner.state.running ? api.stopRunner(runner.id) : api.startRunner(runner.id)),
    onSuccess: (updated) => {
      queryClient.setQueryData<Runner[]>(["runners"], (old) =>
        old ? old.map((r) => (r.id === updated.id ? updated : r)) : undefined,
      );
    },
  });
  const { state } = runner;
  const last = state.lastJob;

  return (
    <div
      className="p-4 rounded-xl border border-border bg-surface hover:border-primary/30 hover:shadow-sm transition-all duration-150 cursor-pointer group flex flex-col gap-3"
      onClick={onOpen}
    >
      <div className="flex items-start gap-3">
        <div className={`w-2.5 h-2.5 mt-1.5 rounded-full shrink-0 ${state.running ? "bg-green-500 animate-pulse" : "bg-text-muted/40"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-text truncate">{runner.name}</span>
            <Badge variant={TOOL_BADGE[runner.tool] ?? "default"}>{runner.tool}</Badge>
            <Badge>{runner.role}</Badge>
            {runner.permissionMode === "full" && <Badge variant="warning">full access</Badge>}
          </div>
          <div className="text-xs text-text-muted mt-1 truncate">
            {projectName ?? "Any project"}
            {runner.model ? ` · ${runner.model}` : ""} · every {runner.pollIntervalSec}s · up to {runner.concurrency} job
            {runner.concurrency === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant={state.running ? "secondary" : "primary"} onClick={() => toggle.mutate()} disabled={toggle.isPending}>
            {toggle.isPending ? "..." : state.running ? "Stop" : "Start"}
          </Button>
          <button onClick={onEdit} className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-secondary transition-colors" title="Edit">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <span>
          <span className={state.running ? "text-green-600 dark:text-green-400" : "text-text-muted"}>{state.running ? "Running" : "Stopped"}</span>
          {" · "}
          {state.activeJobs} active
          {" · "}
          {state.jobCount} job{state.jobCount === 1 ? "" : "s"}
        </span>
        {last && (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-text-muted">last:</span>
            <Badge variant={JOB_BADGE[last.status].variant} dot={last.status === "running"}>
              {JOB_BADGE[last.status].label}
            </Badge>
            <span className="truncate">{last.taskTitle}</span>
          </span>
        )}
      </div>
      {state.lastError && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 truncate" title={state.lastError}>
          {state.lastError}
        </div>
      )}
    </div>
  );
}

export function RunnersPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Runner | null>(null);
  const [deleting, setDeleting] = useState<Runner | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: runners = [], isLoading } = useQuery({
    queryKey: ["runners"],
    queryFn: api.getRunners,
    refetchInterval: 15_000,
  });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: api.getProjects });

  // Subscribing here keeps the cached runner state fresh via runner_updated events.
  useSSE(useCallback(() => {}, []), queryClient);

  const projectName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.displayName ?? id : null);
  const open = openId ? runners.find((r) => r.id === openId) ?? null : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Runners</h2>
        <span className="text-xs text-text-muted hidden sm:inline">
          Runners claim tasks and launch your coding tool headless in the project directory.
        </span>
        <div className="flex-1" />
        <Button onClick={() => setShowCreate(true)} variant="primary" size="sm">
          New Runner
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="p-4 rounded-xl border border-border space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>
        )}
        {!isLoading && runners.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
            </svg>
            <p className="text-sm">No runners yet.</p>
            <p className="text-xs mt-1">Create one and it will pick up tasks from the board within seconds.</p>
          </div>
        )}
        {runners.length > 0 && (
          <div className="space-y-2">
            {runners.map((runner) => (
              <RunnerCard
                key={runner.id}
                runner={runner}
                projectName={projectName(runner.projectId)}
                onOpen={() => setOpenId(runner.id)}
                onEdit={() => setEditing(runner)}
                onDelete={() => setDeleting(runner)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && <RunnerModal projects={projects} onClose={() => setShowCreate(false)} />}
      {editing && <RunnerModal runner={editing} projects={projects} onClose={() => setEditing(null)} />}
      {deleting && <DeleteRunnerModal runner={deleting} onClose={() => setDeleting(null)} />}
      {open && <JobsDrawer runner={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
