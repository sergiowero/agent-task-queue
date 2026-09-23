import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import type { Task } from "../lib/api";
import {
  AgentsIcon,
  AiReviewIcon,
  ApproveIcon,
  ArchiveIcon,
  BranchIcon,
  CalendarIcon,
  CancelTaskIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  CompleteIcon,
  ConversationIcon,
  CriteriaIcon,
  DescriptionIcon,
  EditIcon,
  ErrorIcon,
  GuardrailIcon,
  HistoryIcon,
  MergeIcon,
  PlanIcon,
  PriorityIcon,
  RefreshIcon,
  RequestChangesIcon,
  SaveIcon,
  SteerIcon,
  UnblockIcon,
  WorktreeIcon,
} from "../lib/icons";
import { TONE_SOFT, TOOL_TONE, priorityTone, taskStatusMeta } from "../lib/status";
import { formatDateTime, formatRelative } from "../lib/format";
import { cn } from "../lib/cn";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { Badge, StatusBadge } from "../components/Badge";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Field } from "../components/Field";
import { Tabs } from "../components/Tabs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { PageBody, PageHeader } from "../components/PageHeader";
import { ConversationEntryCard } from "../components/ConversationEntryCard";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { EditableField, PropertyRow } from "../components/EditableField";
import { Skeleton } from "../components/Skeleton";
import { ArchiveTaskModal } from "../components/ArchiveTaskModal";

const ACTIVE_STATUSES = new Set([
  "plan_requested",
  "ready_for_code",
  "planning",
  "waiting_plan_review",
  "plan_changes_requested",
  "coding",
  "waiting_code_review",
  "code_review_requested",
  "reviewing",
  "changes_requested",
  "approved",
  "merging",
  "merged",
]);

const EDITABLE_STATUSES = new Set([
  "plan_requested",
  "ready_for_code",
  "plan_changes_requested",
  "code_review_requested",
  "changes_requested",
  "approved",
  "waiting_plan_review",
  "waiting_code_review",
]);

type TaskAction =
  | "approvePlan"
  | "requestPlanChanges"
  | "approveCode"
  | "requestCodeChanges"
  | "requestAiReview"
  | "confirmCompletion"
  | "unblock"
  | "cancel";

const ACTION_DONE: Record<TaskAction, string> = {
  approvePlan: "Plan approved",
  requestPlanChanges: "Plan changes requested",
  approveCode: "Code approved",
  requestCodeChanges: "Code changes requested",
  requestAiReview: "AI review requested",
  confirmCompletion: "Task completed",
  unblock: "Task unblocked",
  cancel: "Task canceled",
};

/** One line under the "Actions" eyebrow saying what the task is waiting for. */
const ACTION_HINT: Record<string, string> = {
  plan_requested: "Waiting for an agent to write a plan.",
  planning: "An agent is writing the plan.",
  waiting_plan_review: "The plan is ready for your review.",
  plan_changes_requested: "Waiting for an agent to revise the plan.",
  ready_for_code: "Waiting for an agent to write the code.",
  coding: "An agent is writing the code.",
  waiting_code_review: "The code is ready for your review.",
  code_review_requested: "Waiting for an AI review.",
  reviewing: "An agent is reviewing the code.",
  changes_requested: "Waiting for an agent to apply the requested changes.",
  approved: "Approved. Waiting for an agent to merge it.",
  merging: "An agent is merging the branch.",
  merged: "Merged. Confirm to mark the task complete.",
};

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"conversation" | "history">("conversation");
  const [feedback, setFeedback] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const {
    data: task,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["task", id],
    queryFn: () => api.getTask(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });

  const mutation = useMutation({
    mutationFn: ({ action, data }: { action: TaskAction; data?: { message: string } }) => {
      const fn = api[action] as (taskId: string, data?: unknown) => Promise<Task>;
      return data !== undefined ? fn(id!, data) : fn(id!);
    },
    onSuccess: (_task, { action }) => {
      queryClient.invalidateQueries({ queryKey: ["task", id] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setFeedback("");
      toast.success(ACTION_DONE[action]);
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Task>) => api.updateTask(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", id] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const doAction = (action: TaskAction, data?: { message: string }) =>
    mutation.mutate({ action, data });

  const pendingAction = mutation.isPending ? mutation.variables?.action : undefined;
  /** Spinner on the clicked button, every other action disabled meanwhile. */
  const busy = (action: TaskAction) => ({
    loading: pendingAction === action,
    disabled: mutation.isPending,
  });

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task?.title) {
      try {
        await updateMutation.mutateAsync({ title: trimmed });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save the title");
        return;
      }
    }
    setTitleEditing(false);
  }

  if (!task) {
    if (error) {
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          <PageHeader back={{ to: "/board", label: "Back to board" }} title="Task" />
          <PageBody>
            <EmptyState
              icon={ErrorIcon}
              title="Couldn't load this task"
              description={error.message}
              action={
                <Button
                  variant="secondary"
                  icon={RefreshIcon}
                  loading={isRefetching}
                  onClick={() => refetch()}
                >
                  Try again
                </Button>
              }
            />
          </PageBody>
        </div>
      );
    }
    return <TaskDetailSkeleton />;
  }

  const canEdit = EDITABLE_STATUSES.has(task.status);
  const isActive = ACTIVE_STATUSES.has(task.status);
  const reviewingPlan = task.status === "waiting_plan_review";
  const reviewingCode = task.status === "waiting_code_review";
  const conversation = task.conversation ?? [];
  const history = task.history ?? [];

  const title = titleEditing ? (
    // Padding keeps the input's focus ring inside the heading's clipped box.
    <div className="flex w-[40rem] max-w-full items-center gap-1 p-1">
      <Input
        autoFocus
        inputSize="sm"
        aria-label="Task title"
        value={titleDraft}
        disabled={updateMutation.isPending}
        onChange={(e) => setTitleDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") saveTitle();
          if (e.key === "Escape") setTitleEditing(false);
        }}
        className="font-semibold"
      />
      <IconButton
        icon={SaveIcon}
        label="Save title"
        variant="primary"
        loading={updateMutation.isPending}
        onClick={saveTitle}
      />
      <IconButton
        icon={CloseIcon}
        label="Cancel"
        disabled={updateMutation.isPending}
        onClick={() => setTitleEditing(false)}
      />
    </div>
  ) : (
    task.title
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        back={{ to: "/board", label: "Back to board" }}
        title={title}
        meta={
          <>
            {canEdit && !titleEditing && (
              <IconButton
                icon={EditIcon}
                label="Edit title"
                size="xs"
                onClick={() => {
                  setTitleDraft(task.title);
                  setTitleEditing(true);
                }}
              />
            )}
            <StatusBadge status={task.status} size="md" />
            {task.archivedAt && (
              <Badge tone="neutral" size="md" icon={ArchiveIcon}>
                Archived
              </Badge>
            )}
          </>
        }
      />

      <PageBody>
        <div className="mx-auto grid max-w-[1400px] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
            {isActive && (
              <section className="card p-4">
                <h2 className="eyebrow">Actions</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  {ACTION_HINT[task.status] ?? "Waiting for an agent."}
                </p>
                {(reviewingPlan || reviewingCode) && (
                  <Field
                    label="Feedback"
                    icon={ConversationIcon}
                    hint="Sent to the agent when you request changes."
                    className="mt-4"
                  >
                    <Textarea
                      rows={2}
                      placeholder="What should change? (optional)"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                  </Field>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {reviewingPlan && (
                    <>
                      <Button
                        icon={ApproveIcon}
                        {...busy("approvePlan")}
                        onClick={() => doAction("approvePlan")}
                      >
                        Approve plan
                      </Button>
                      <Button
                        variant="secondary"
                        icon={RequestChangesIcon}
                        {...busy("requestPlanChanges")}
                        onClick={() =>
                          doAction("requestPlanChanges", {
                            message: feedback || "Plan changes requested.",
                          })
                        }
                      >
                        Request changes
                      </Button>
                    </>
                  )}
                  {reviewingCode && (
                    <>
                      <Button
                        icon={ApproveIcon}
                        {...busy("approveCode")}
                        onClick={() => doAction("approveCode")}
                      >
                        Approve code
                      </Button>
                      <Button
                        variant="secondary"
                        icon={RequestChangesIcon}
                        {...busy("requestCodeChanges")}
                        onClick={() =>
                          doAction("requestCodeChanges", {
                            message: feedback || "Code changes requested.",
                          })
                        }
                      >
                        Request changes
                      </Button>
                      <Button
                        variant="secondary"
                        icon={AiReviewIcon}
                        {...busy("requestAiReview")}
                        onClick={() => doAction("requestAiReview")}
                      >
                        AI review
                      </Button>
                    </>
                  )}
                  {task.status === "merged" && (
                    <Button
                      icon={CompleteIcon}
                      {...busy("confirmCompletion")}
                      onClick={() => doAction("confirmCompletion")}
                    >
                      Confirm complete
                    </Button>
                  )}
                  {["planning", "coding", "reviewing"].includes(task.status) && (
                    <Button
                      variant="ghost"
                      icon={UnblockIcon}
                      {...busy("unblock")}
                      onClick={() => doAction("unblock")}
                    >
                      Unblock
                    </Button>
                  )}
                  <Button
                    variant="danger-ghost"
                    icon={CancelTaskIcon}
                    className="ml-auto"
                    {...busy("cancel")}
                    onClick={() => setConfirmCancel(true)}
                  >
                    Cancel task
                  </Button>
                </div>
              </section>
            )}

            {task.status === "complete" && !task.archivedAt && (
              <section className="card p-4">
                <h2 className="eyebrow">Actions</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Complete. Archive it to save a summary and the full record in the project's
                  archive folder and clear it from the board.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button icon={ArchiveIcon} onClick={() => setConfirmArchive(true)}>
                    Archive
                  </Button>
                </div>
              </section>
            )}

            <EditableField
              icon={DescriptionIcon}
              label="Description"
              value={task.description ?? ""}
              placeholder="Description"
              editable={canEdit}
              display={
                task.description ? (
                  <MarkdownRenderer content={task.description} />
                ) : (
                  <EmptyValue>No description</EmptyValue>
                )
              }
              onSubmit={async (v) =>
                await updateMutation.mutateAsync({ description: v.trim() ? v : null })
              }
            />

            <EditableField
              icon={SteerIcon}
              label="Steer details"
              value={task.steerDetails ?? ""}
              placeholder="Implementation guidance, technical recommendations, preferred approaches"
              editable={canEdit}
              display={
                task.steerDetails ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                    {task.steerDetails}
                  </p>
                ) : (
                  <EmptyValue>No steer details</EmptyValue>
                )
              }
              onSubmit={async (v) =>
                await updateMutation.mutateAsync({ steerDetails: v.trim() ? v : null })
              }
            />

            <div className="grid gap-4 md:grid-cols-2">
              <EditableField
                icon={GuardrailIcon}
                label="Guardrails"
                value={task.guardrails?.join("\n") ?? ""}
                placeholder="One constraint per line"
                editable={canEdit}
                display={
                  task.guardrails?.length > 0 ? (
                    <ol className="space-y-2">
                      {task.guardrails.map((g, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 text-sm text-text-secondary"
                        >
                          <span
                            className={cn(
                              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums",
                              TONE_SOFT.warning,
                            )}
                          >
                            {i + 1}
                          </span>
                          <span className="pt-px leading-snug">{g}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyValue>No guardrails</EmptyValue>
                  )
                }
                onSubmit={async (v) =>
                  await updateMutation.mutateAsync({
                    guardrails: v
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
              <EditableField
                icon={CriteriaIcon}
                label="Acceptance criteria"
                value={task.acceptanceCriteria?.join("\n") ?? ""}
                placeholder="One criterion per line"
                editable={canEdit}
                display={
                  task.acceptanceCriteria?.length > 0 ? (
                    <ul className="space-y-2">
                      {task.acceptanceCriteria.map((c, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 text-sm text-text-secondary"
                        >
                          <CheckIcon
                            aria-hidden
                            className="mt-0.5 h-4 w-4 shrink-0 text-success"
                            strokeWidth={2.5}
                          />
                          <span className="pt-px leading-snug">{c}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyValue>No acceptance criteria</EmptyValue>
                  )
                }
                onSubmit={async (v) =>
                  await updateMutation.mutateAsync({
                    acceptanceCriteria: v
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          </div>

          <aside className="min-w-0 xl:sticky xl:top-0 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start">
            <div className="card">
              <div className="flex h-11 items-center border-b border-border-light px-4">
                <h2 className="eyebrow">Details</h2>
              </div>
              <div className="grid px-4 py-1 sm:grid-cols-2 sm:gap-x-8 xl:grid-cols-1 xl:divide-y xl:divide-border-light">
                <EditableField
                  variant="property"
                  icon={PriorityIcon}
                  label="Priority"
                  value={String(task.priority)}
                  placeholder="0"
                  rows={1}
                  editable={canEdit}
                  display={
                    <Badge tone={priorityTone(task.priority)} icon={PriorityIcon}>
                      P{task.priority}
                    </Badge>
                  }
                  onSubmit={async (v) => {
                    const p = parseInt(v, 10);
                    if (isNaN(p)) throw new Error("Priority must be a number");
                    await updateMutation.mutateAsync({ priority: p });
                  }}
                />
                <EditableField
                  variant="property"
                  icon={BranchIcon}
                  label="Branch"
                  value={task.recommendedBranch || ""}
                  placeholder="Branch name"
                  rows={1}
                  editable={canEdit}
                  display={
                    task.recommendedBranch ? (
                      <>
                        <Mono>{task.recommendedBranch}</Mono>
                        <CopyButton size="xs" value={task.recommendedBranch} label="Copy branch" />
                      </>
                    ) : (
                      <EmptyValue>—</EmptyValue>
                    )
                  }
                  onSubmit={async (v) =>
                    await updateMutation.mutateAsync({ recommendedBranch: v.trim() })
                  }
                />
                <EditableField
                  variant="property"
                  icon={MergeIcon}
                  label="Merge target"
                  value={task.mergeBranch}
                  placeholder="Merge branch"
                  rows={1}
                  editable={canEdit}
                  display={<Mono>{task.mergeBranch}</Mono>}
                  onSubmit={async (v) =>
                    await updateMutation.mutateAsync({ mergeBranch: v.trim() })
                  }
                />
                <PropertyRow icon={PlanIcon} label="Requires plan">
                  <Badge tone={task.requiresPlan ? "accent" : "neutral"}>
                    {task.requiresPlan ? "Yes" : "No"}
                  </Badge>
                </PropertyRow>
                <PropertyRow icon={WorktreeIcon} label="Worktree">
                  {task.worktreePath ? (
                    <>
                      <Mono>{task.worktreePath}</Mono>
                      <CopyButton size="xs" value={task.worktreePath} label="Copy worktree path" />
                    </>
                  ) : (
                    <EmptyValue>—</EmptyValue>
                  )}
                </PropertyRow>
                <PropertyRow icon={AgentsIcon} label="Agent">
                  {task.assignedAgent ? (
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={task.assignedAgent.name}>
                        {task.assignedAgent.name}
                      </div>
                      <div className="mt-1 flex min-w-0 items-center justify-end gap-1.5">
                        <Badge tone={TOOL_TONE[task.assignedAgent.tool] ?? "neutral"}>
                          {task.assignedAgent.tool}
                        </Badge>
                        {task.assignedAgent.model && <Mono muted>{task.assignedAgent.model}</Mono>}
                      </div>
                    </div>
                  ) : (
                    <EmptyValue>Unassigned</EmptyValue>
                  )}
                </PropertyRow>
                {task.archivedAt && task.archivePath && (
                  <PropertyRow icon={ArchiveIcon} label="Archive">
                    <Mono>{task.archivePath}</Mono>
                    <CopyButton size="xs" value={task.archivePath} label="Copy archive path" />
                  </PropertyRow>
                )}
                <PropertyRow icon={CalendarIcon} label="Created">
                  <RelativeTime value={task.createdAt} />
                </PropertyRow>
                <PropertyRow icon={ClockIcon} label="Updated">
                  <RelativeTime value={task.updatedAt} />
                </PropertyRow>
              </div>
            </div>
          </aside>

          <section className="min-w-0 xl:col-start-1 xl:row-start-2">
            <Tabs
              label="Task activity"
              value={tab}
              onChange={setTab}
              className="border-b border-border"
              items={[
                {
                  value: "conversation",
                  label: "Conversation",
                  icon: ConversationIcon,
                  count: conversation.length,
                },
                { value: "history", label: "History", icon: HistoryIcon, count: history.length },
              ]}
            />
            <div
              key={tab}
              role="tabpanel"
              aria-label={tab === "conversation" ? "Conversation" : "History"}
              className="pt-5 animate-fade-in"
            >
              {tab === "conversation" ? (
                <ConversationTimeline entries={conversation} />
              ) : (
                <HistoryTimeline entries={history} />
              )}
            </div>
          </section>
        </div>
      </PageBody>

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel this task?"
          icon={CancelTaskIcon}
          confirmLabel="Cancel task"
          cancelLabel="Keep task"
          message={
            <>
              Agents stop working on <span className="font-medium text-text">{task.title}</span> and
              it leaves the queue. This cannot be undone.
            </>
          }
          // Rejects on failure (already toasted), which keeps the dialog open.
          onConfirm={() => mutation.mutateAsync({ action: "cancel" })}
          onClose={() => setConfirmCancel(false)}
        />
      )}

      {confirmArchive && (
        <ArchiveTaskModal
          task={task}
          project={projects.find((p) => p.id === task.projectId)}
          onClose={() => setConfirmArchive(false)}
        />
      )}
    </div>
  );
}

function ConversationTimeline({ entries }: { entries: Task["conversation"] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={ConversationIcon}
        title="No messages yet"
        description="Plans, reviews and agent notes will show up here."
      />
    );
  }
  // Newest first; keys are the original indexes, which stay stable as entries are appended.
  const newestFirst = entries.map((entry, index) => ({ entry, index })).reverse();
  return (
    <ol className="space-y-5">
      {newestFirst.map(({ entry, index }, i) => (
        <li key={index} className="stagger relative" style={stagger(i)}>
          {i < newestFirst.length - 1 && (
            <span
              aria-hidden
              className="absolute -bottom-4 left-4 top-9 w-px -translate-x-1/2 bg-border"
            />
          )}
          <ConversationEntryCard entry={entry} />
        </li>
      ))}
    </ol>
  );
}

function HistoryTimeline({ entries }: { entries: Task["history"] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={HistoryIcon}
        title="No history yet"
        description="Status changes will be listed here."
      />
    );
  }
  return (
    <ol>
      {entries.map((h, i) => {
        const meta = taskStatusMeta(h.new_status);
        const Icon = meta.icon;
        return (
          <li key={i} className="stagger relative flex gap-3 pb-5 last:pb-0" style={stagger(i)}>
            {i < entries.length - 1 && (
              <span
                aria-hidden
                className="absolute bottom-1 left-3.5 top-8 w-px -translate-x-1/2 bg-border"
              />
            )}
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                TONE_SOFT[meta.tone],
              )}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />
            </div>
            <div className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              {h.pre_status && (
                <>
                  <span className="text-[13px] text-text-muted">
                    {taskStatusMeta(h.pre_status).label}
                  </span>
                  <ChevronRightIcon aria-hidden className="h-3.5 w-3.5 text-text-muted" />
                </>
              )}
              <StatusBadge status={h.new_status} />
              <RelativeTime value={h.timestamp} className="ml-auto text-xs text-text-muted" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function EmptyValue({ children }: { children: ReactNode }) {
  return <span className="text-sm italic text-text-muted">{children}</span>;
}

function Mono({ children, muted = false }: { children: string; muted?: boolean }) {
  return (
    <span
      title={children}
      className={cn("truncate font-mono text-xs", muted ? "text-text-muted" : "text-text")}
    >
      {children}
    </span>
  );
}

function RelativeTime({ value, className }: { value: string; className?: string }) {
  return (
    <time dateTime={value} title={formatDateTime(value)} className={className}>
      {formatRelative(value)}
    </time>
  );
}

function TaskDetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" aria-busy="true">
      <div className="flex min-h-16 shrink-0 items-center gap-4 border-b border-border bg-surface/80 px-6 py-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-5 w-72 max-w-[50%]" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <div className="flex-1 overflow-hidden px-6 py-6">
        <div className="mx-auto grid max-w-[1400px] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="card space-y-3 p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-9 w-32 rounded-lg" />
                <Skeleton className="h-9 w-36 rounded-lg" />
              </div>
            </div>
            <div className="card space-y-3 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="card space-y-3 p-4">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          </div>
          <div className="card space-y-4 self-start p-4">
            <Skeleton className="h-3 w-14" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
