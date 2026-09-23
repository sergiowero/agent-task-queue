import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import type { Runner, RunnerJob, RunnerJobEvent } from "../lib/api";
import { api } from "../lib/api";
import type { LucideIcon } from "../lib/icons";
import {
  AddIcon,
  ClockIcon,
  ConcurrencyIcon,
  DeleteIcon,
  DurationIcon,
  EditIcon,
  EffortIcon,
  ExternalLinkIcon,
  FolderIcon,
  FollowIcon,
  FullAccessIcon,
  LogsIcon,
  ModelIcon,
  RunnersIcon,
  StartIcon,
  StopIcon,
  TerminalIcon,
  ZapIcon,
} from "../lib/icons";
import type { Tone } from "../lib/status";
import { TONE_SOFT, TOOL_TONE } from "../lib/status";
import { formatDateTime, formatDuration, formatRelative, pluralize } from "../lib/format";
import { cn } from "../lib/cn";
import { useSSE } from "../hooks/useSSE";
import { Alert } from "../components/Alert";
import { Badge, Dot, JobStatusBadge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { Drawer, useModal } from "../components/Modal";
import { CountPill, PageBody, PageHeader } from "../components/PageHeader";
import { RunnerModal } from "../components/RunnerModal";
import { Skeleton } from "../components/Skeleton";

function DeleteRunnerModal({ runner, onClose }: { runner: Runner; onClose: () => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.deleteRunner(runner.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runners"] });
    },
  });
  return (
    <ConfirmDialog
      title="Delete runner?"
      message={
        <>
          <span className="font-medium text-text">{runner.name}</span> will be deleted. Running jobs
          are killed and their tasks released back to the queue.
        </>
      }
      confirmLabel="Delete runner"
      onConfirm={async () => {
        try {
          await mutation.mutateAsync();
          toast.success("Runner deleted");
        } catch (e) {
          toast.error((e as Error).message);
          throw e;
        }
      }}
      onClose={onClose}
    />
  );
}

/** Small mono chip for the job phase, pid and exit code. */
function MonoChip({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 font-mono text-[11px]",
        TONE_SOFT[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Icon + text pair used in the runner meta line. */
function MetaItem({
  icon: Icon,
  children,
  mono = false,
}: {
  icon: LucideIcon;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className={cn("truncate", mono && "font-mono")}>{children}</span>
    </span>
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

  const hasExit = job.exitCode !== undefined && job.exitCode !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-text-secondary">
        <JobStatusBadge status={job.status} />
        <MonoChip>{job.phase}</MonoChip>
        <Link
          to={`/tasks/${job.taskId}/details`}
          className="inline-flex min-w-0 max-w-[16rem] items-center gap-1 font-medium text-primary transition-colors duration-150 hover:underline"
        >
          <span className="truncate">{job.taskTitle}</span>
          <ExternalLinkIcon aria-hidden className="h-3 w-3 shrink-0" />
        </Link>
        <div className="flex-1" />
        {job.pid !== null && <MonoChip>pid {job.pid}</MonoChip>}
        {hasExit && (
          <MonoChip tone={job.exitCode === 0 ? "success" : "danger"}>exit {job.exitCode}</MonoChip>
        )}
        <span className="inline-flex items-center gap-1 tabular-nums text-text-muted">
          <DurationIcon aria-hidden className="h-3.5 w-3.5" />
          {formatDuration(job.startedAt, job.finishedAt)}
        </span>
        {!follow && (
          <Button
            size="sm"
            variant="ghost"
            icon={FollowIcon}
            className="animate-fade-in"
            onClick={() => {
              setFollow(true);
              if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
            }}
          >
            Follow
          </Button>
        )}
        <CopyButton value={text} label="Copy log" />
      </div>
      <pre
        ref={preRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-canvas px-4 py-3 font-mono text-xs leading-relaxed text-text-secondary"
      >
        {loading ? (
          <span className="text-text-muted">Loading log...</span>
        ) : (
          text || <span className="text-text-muted">(no output yet)</span>
        )}
      </pre>
    </div>
  );
}

function JobsDrawer({ runner, onClose }: { runner: Runner; onClose: () => void }) {
  const queryClient = useQueryClient();
  const drawer = useModal(onClose);
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

  return (
    <Drawer
      {...drawer.props}
      header={
        <>
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              TONE_SOFT[runner.state.running ? "success" : "neutral"],
            )}
          >
            <RunnersIcon aria-hidden className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold tracking-tight text-text">
              {runner.name}
            </h3>
            <p className="text-xs text-text-muted">
              {isLoading ? "Loading jobs..." : pluralize(jobs.length, "job")}
            </p>
          </div>
          <Badge tone={TOOL_TONE[runner.tool] ?? "neutral"}>{runner.tool}</Badge>
          <Badge>{runner.role}</Badge>
        </>
      }
    >
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="eyebrow shrink-0 border-b border-border-light px-4 py-2.5">Jobs</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && (
            <div className="space-y-px">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2 border-b border-border-light px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-4 w-10" />
                  </div>
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          )}
          {!isLoading && jobs.length === 0 && (
            <EmptyState
              compact
              icon={LogsIcon}
              title="No jobs yet"
              description="Jobs appear here as soon as the runner claims a task."
            />
          )}
          {jobs.map((job, i) => {
            const active = selected?.id === job.id;
            return (
              <button
                key={job.id}
                type="button"
                aria-current={active || undefined}
                onClick={() => setSelectedId(job.id)}
                className={cn(
                  "stagger relative block w-full border-b border-border-light px-4 py-3 text-left transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60",
                  active ? "bg-primary/[0.06]" : "hover:bg-surface-secondary",
                )}
                style={{ "--i": i } as CSSProperties}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-primary transition-all duration-200 ease-out-expo",
                    active ? "opacity-100" : "scale-y-50 opacity-0",
                  )}
                />
                <div className="flex items-center gap-2">
                  <JobStatusBadge status={job.status} />
                  <MonoChip>{job.phase}</MonoChip>
                  <span className="flex-1" />
                  <span className="inline-flex items-center gap-1 text-xs tabular-nums text-text-muted">
                    <DurationIcon aria-hidden className="h-3 w-3" />
                    {formatDuration(job.startedAt, job.finishedAt)}
                  </span>
                </div>
                <div
                  className={cn(
                    "mt-1.5 truncate text-sm",
                    active ? "font-medium text-text" : "text-text-secondary",
                  )}
                >
                  {job.taskTitle}
                </div>
                <div
                  className="mt-0.5 text-xs text-text-muted"
                  title={formatDateTime(job.startedAt)}
                >
                  {formatRelative(job.startedAt)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <LogPanel key={selected.id} runnerId={runner.id} job={selected} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-canvas text-sm text-text-muted">
            <TerminalIcon aria-hidden className="h-5 w-5" />
            Select a job to see its output.
          </div>
        )}
      </div>
    </Drawer>
  );
}

function RunnerCard({
  runner,
  index,
  projectName,
  onOpen,
  onEdit,
  onDelete,
}: {
  runner: Runner;
  index: number;
  projectName: string | null;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      runner.state.running ? api.stopRunner(runner.id) : api.startRunner(runner.id),
    onSuccess: (updated) => {
      queryClient.setQueryData<Runner[]>(["runners"], (old) =>
        old ? old.map((r) => (r.id === updated.id ? updated : r)) : undefined,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const { state } = runner;
  const last = state.lastJob;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Show jobs of ${runner.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="card-interactive group stagger p-4"
      style={{ "--i": index } as CSSProperties}
    >
      <div className="flex flex-wrap items-start gap-3.5">
        <div className="relative shrink-0">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-200",
              TONE_SOFT[state.running ? "success" : "neutral"],
            )}
          >
            <RunnersIcon aria-hidden className="h-5 w-5" />
          </div>
          {state.running && (
            <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface">
              <Dot tone="success" pulse className="h-2 w-2" />
            </span>
          )}
        </div>

        <div className="min-w-[10rem] flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 truncate text-sm font-semibold text-text">{runner.name}</span>
            <Badge tone={TOOL_TONE[runner.tool] ?? "neutral"}>{runner.tool}</Badge>
            <Badge>{runner.role}</Badge>
            {runner.permissionMode === "full" && (
              <Badge tone="warning" icon={FullAccessIcon}>
                full access
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-text-muted">
            <MetaItem icon={FolderIcon}>{projectName ?? "Any project"}</MetaItem>
            {runner.model && (
              <MetaItem icon={ModelIcon} mono>
                {runner.model}
              </MetaItem>
            )}
            {runner.effort && <MetaItem icon={EffortIcon}>{runner.effort}</MetaItem>}
            <MetaItem icon={ClockIcon}>every {runner.pollIntervalSec}s</MetaItem>
            <MetaItem icon={ConcurrencyIcon}>up to {pluralize(runner.concurrency, "job")}</MetaItem>
          </div>
        </div>

        <div
          className="ml-auto flex shrink-0 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant={state.running ? "secondary" : "primary"}
            icon={state.running ? StopIcon : StartIcon}
            loading={toggle.isPending}
            onClick={() => toggle.mutate()}
            className="mr-1"
          >
            {state.running ? "Stop" : "Start"}
          </Button>
          <IconButton icon={LogsIcon} label="View jobs" onClick={onOpen} />
          <IconButton icon={EditIcon} label="Edit runner" onClick={onEdit} />
          <IconButton icon={DeleteIcon} label="Delete runner" variant="danger" onClick={onDelete} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border-light pt-3 text-xs text-text-secondary">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-medium",
            state.running ? "text-success" : "text-text-muted",
          )}
        >
          <Dot tone={state.running ? "success" : "neutral"} />
          {state.running ? "Running" : "Stopped"}
        </span>
        <span className="tabular-nums">
          {state.activeJobs} active · {pluralize(state.jobCount, "job")}
        </span>
        {last && (
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="text-text-muted">Last job</span>
            <JobStatusBadge status={last.status} />
            <span className="truncate">{last.taskTitle}</span>
            <span className="shrink-0 text-text-muted" title={formatDateTime(last.startedAt)}>
              {formatRelative(last.startedAt)}
            </span>
          </span>
        )}
      </div>
      {state.lastError && (
        <Alert tone="danger" className="mt-3">
          <span className="block truncate" title={state.lastError}>
            {state.lastError}
          </span>
        </Alert>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  live = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: Tone;
  live?: boolean;
}) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <div
        className={cn(
          "hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 sm:flex",
          TONE_SOFT[value > 0 ? tone : "neutral"],
        )}
      >
        <Icon aria-hidden className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0">
        <div className="eyebrow truncate">{label}</div>
        <div className="flex items-center gap-2 text-lg font-semibold leading-tight tabular-nums text-text">
          {value}
          {live && <Dot tone="success" pulse />}
        </div>
      </div>
    </div>
  );
}

function RunnerCardSkeleton() {
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3.5">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-2 pt-0.5">
          <div className="flex gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
      <div className="mt-3 border-t border-border-light pt-3">
        <Skeleton className="h-3 w-56" />
      </div>
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
  useSSE(
    useCallback(() => {}, []),
    queryClient,
  );

  const projectName = (id: string | null) =>
    id ? (projects.find((p) => p.id === id)?.displayName ?? id) : null;
  const open = openId ? (runners.find((r) => r.id === openId) ?? null) : null;

  const runningCount = runners.filter((r) => r.state.running).length;
  const activeJobs = runners.reduce((sum, r) => sum + r.state.activeJobs, 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        icon={RunnersIcon}
        title="Runners"
        description="Claim tasks and run your coding tool headless in the project directory."
        meta={!isLoading && <CountPill>{runners.length}</CountPill>}
        actions={
          <Button icon={AddIcon} onClick={() => setShowCreate(true)}>
            New runner
          </Button>
        }
      />

      <PageBody>
        {isLoading && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[62px] rounded-xl" />
              ))}
            </div>
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <RunnerCardSkeleton key={i} />
              ))}
            </div>
          </div>
        )}
        {!isLoading && runners.length === 0 && (
          <EmptyState
            icon={RunnersIcon}
            title="No runners yet"
            description="Create one and it will pick up tasks from the board within seconds."
            action={
              <Button icon={AddIcon} onClick={() => setShowCreate(true)}>
                New runner
              </Button>
            }
          />
        )}
        {runners.length > 0 && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <StatCard icon={RunnersIcon} label="Runners" value={runners.length} tone="primary" />
              <StatCard
                icon={StartIcon}
                label="Running"
                value={runningCount}
                tone="success"
                live={runningCount > 0}
              />
              <StatCard icon={ZapIcon} label="Active jobs" value={activeJobs} tone="info" />
            </div>
            <div className="space-y-3">
              {runners.map((runner, i) => (
                <RunnerCard
                  key={runner.id}
                  runner={runner}
                  index={i}
                  projectName={projectName(runner.projectId)}
                  onOpen={() => setOpenId(runner.id)}
                  onEdit={() => setEditing(runner)}
                  onDelete={() => setDeleting(runner)}
                />
              ))}
            </div>
          </div>
        )}
      </PageBody>

      {showCreate && <RunnerModal projects={projects} onClose={() => setShowCreate(false)} />}
      {editing && (
        <RunnerModal runner={editing} projects={projects} onClose={() => setEditing(null)} />
      )}
      {deleting && <DeleteRunnerModal runner={deleting} onClose={() => setDeleting(null)} />}
      {open && <JobsDrawer runner={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
