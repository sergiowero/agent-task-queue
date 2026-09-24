import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { EVENT_TYPES } from "@agentq/shared/catalog";
import type { ActivityEvent } from "../lib/api";
import { api } from "../lib/api";
import type { LucideIcon } from "../lib/icons";
import {
  ActivityIcon,
  AddIcon,
  AgentsIcon,
  AiReviewIcon,
  ApproveIcon,
  ArchiveIcon,
  CancelTaskIcon,
  ChevronRightIcon,
  CompleteIcon,
  ConversationIcon,
  InProgressIcon,
  MergeIcon,
  NeedsHumanIcon,
  PlanIcon,
  RequestChangesIcon,
  RevertedIcon,
  ReviewIcon,
  TerminalIcon,
  UnblockIcon,
} from "../lib/icons";
import type { Tone } from "../lib/status";
import { TONE_SOFT } from "../lib/status";
import { formatDate, formatDateTime, formatRelative } from "../lib/format";
import { cn } from "../lib/cn";
import { EmptyState } from "../components/EmptyState";
import { CountPill, PageBody, PageHeader } from "../components/PageHeader";
import type { SegmentOption } from "../components/SegmentedControl";
import { SegmentedControl } from "../components/SegmentedControl";
import { Skeleton } from "../components/Skeleton";
import { MetricsPanel } from "../components/MetricsPanel";

interface EventMeta {
  label: string;
  icon: LucideIcon;
  tone: Tone;
}

const EVENT_META: Record<string, EventMeta> = {
  task_created: { label: "Task created", icon: AddIcon, tone: "primary" },
  task_completed: { label: "Task completed", icon: CompleteIcon, tone: "success" },
  task_archived: { label: "Task archived", icon: ArchiveIcon, tone: "neutral" },
  task_canceled: { label: "Task canceled", icon: CancelTaskIcon, tone: "danger" },
  task_reverted: { label: "Task reverted", icon: RevertedIcon, tone: "warning" },
  task_unblocked: { label: "Task unblocked", icon: UnblockIcon, tone: "info" },
  task_blocked: { label: "Blocked, needs you", icon: NeedsHumanIcon, tone: "danger" },
  blocker_resolved: { label: "Blocker resolved", icon: UnblockIcon, tone: "success" },
  plan_submitted: { label: "Plan submitted", icon: PlanIcon, tone: "accent" },
  plan_approved: { label: "Plan approved", icon: ApproveIcon, tone: "success" },
  plan_changes_requested: {
    label: "Plan changes requested",
    icon: RequestChangesIcon,
    tone: "warning",
  },
  code_submitted: { label: "Code submitted", icon: TerminalIcon, tone: "info" },
  code_approved: { label: "Code approved", icon: ApproveIcon, tone: "success" },
  code_changes_requested: {
    label: "Code changes requested",
    icon: RequestChangesIcon,
    tone: "warning",
  },
  review_submitted: { label: "Review submitted", icon: ReviewIcon, tone: "warning" },
  merge_submitted: { label: "Merge submitted", icon: MergeIcon, tone: "success" },
  pr_opened: { label: "PR opened", icon: MergeIcon, tone: "primary" },
  pr_merged: { label: "PR merged", icon: MergeIcon, tone: "success" },
  pr_auto_merged: { label: "PR auto-merged", icon: MergeIcon, tone: "success" },
  pr_closed: { label: "PR closed without merging", icon: CancelTaskIcon, tone: "danger" },
  ai_review_requested: { label: "AI review requested", icon: AiReviewIcon, tone: "accent" },
  comment_added: { label: "Comment added", icon: ConversationIcon, tone: "neutral" },
  // Older event names, kept for existing rows.
  agent_claimed: { label: "Agent claimed", icon: AgentsIcon, tone: "accent" },
  status_change: { label: "Status changed", icon: InProgressIcon, tone: "neutral" },
  comment: { label: "Comment", icon: ConversationIcon, tone: "neutral" },
};

function eventMeta(eventType: string): EventMeta {
  if (EVENT_META[eventType]) return EVENT_META[eventType];
  const text = EVENT_TYPES[eventType] ?? eventType.replace(/_/g, " ").trim();
  return {
    label: text.charAt(0).toUpperCase() + text.slice(1),
    icon: ActivityIcon,
    tone: "neutral",
  };
}

type Limit = "25" | "50" | "100";

const LIMIT_OPTIONS: SegmentOption<Limit>[] = [
  { value: "25", label: "25" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(date: Date) {
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return formatDate(date);
}

/** Groups events by local calendar day, keeping the API order. */
function groupByDay(events: ActivityEvent[]) {
  const groups = new Map<number, { label: string; events: ActivityEvent[] }>();
  for (const event of events) {
    const date = new Date(event.createdAt);
    const key = startOfDay(date);
    let group = groups.get(key);
    if (!group) {
      group = { label: dayLabel(date), events: [] };
      groups.set(key, group);
    }
    group.events.push(event);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

function EventRow({ event, index }: { event: ActivityEvent; index: number }) {
  const meta = eventMeta(event.eventType);
  const Icon = meta.icon;
  return (
    <li className="stagger" style={{ "--i": index } as CSSProperties}>
      <Link
        to={`/tasks/${event.taskId}/details`}
        className={cn(
          "group relative flex items-start gap-3 rounded-xl px-2 py-2.5",
          "transition-colors duration-150 hover:bg-surface hover:shadow-xs",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        )}
      >
        {/* Opaque base so the rail line does not show through the tinted tile. */}
        <span className="relative z-10 shrink-0 rounded-lg bg-canvas ring-4 ring-canvas transition-shadow duration-150 group-hover:bg-surface group-hover:ring-surface">
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-transform duration-300 ease-spring group-hover:scale-105",
              TONE_SOFT[meta.tone],
            )}
          >
            <Icon aria-hidden className="h-4 w-4" />
          </span>
        </span>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-sm font-medium text-text">{meta.label}</span>
            {event.actor && (
              <span className="text-xs text-text-muted">
                by <span className="font-medium text-text-secondary">{event.actor}</span>
              </span>
            )}
          </div>
          {event.details && (
            <p className="mt-0.5 line-clamp-2 break-words text-xs leading-relaxed text-text-muted">
              {event.details}
            </p>
          )}
        </div>
        <span
          className="shrink-0 pt-1.5 text-xs tabular-nums text-text-muted"
          title={formatDateTime(event.createdAt)}
        >
          {formatRelative(event.createdAt)}
        </span>
        <ChevronRightIcon
          aria-hidden
          className="mt-1.5 h-4 w-4 shrink-0 -translate-x-1 text-text-muted opacity-0 transition-all duration-200 ease-out-expo group-hover:translate-x-0 group-hover:text-primary group-hover:opacity-100"
        />
      </Link>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3 w-16" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-start gap-3 px-2 py-2.5">
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="mt-1.5 h-3 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function ActivityPage() {
  const [limit, setLimit] = useState(50);

  const { data: eventsRes, isLoading } = useQuery({
    queryKey: ["activity", limit],
    queryFn: () => api.getActivity({ limit }),
  });
  const events = eventsRes?.data ?? [];
  const groups = groupByDay(events);

  let index = 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        icon={ActivityIcon}
        title="Activity"
        description="What happened across all tasks, newest first."
        meta={!isLoading && <CountPill>{events.length}</CountPill>}
        actions={
          <SegmentedControl
            label="Events to show"
            size="sm"
            value={String(limit) as Limit}
            onChange={(v) => setLimit(Number(v))}
            options={LIMIT_OPTIONS}
          />
        }
      />

      <PageBody>
        <div className="mx-auto max-w-3xl">
          <MetricsPanel />
          {isLoading && <TimelineSkeleton />}
          {!isLoading && events.length === 0 && (
            <EmptyState
              icon={ActivityIcon}
              title="No activity yet"
              description="Events appear as tasks are created and updated."
            />
          )}
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <h2 className="eyebrow sticky -top-6 z-20 -mx-2 mb-1 bg-canvas/70 px-2 py-2 backdrop-blur-md">
                  {group.label}
                </h2>
                <ol className="relative">
                  {group.events.length > 1 && (
                    <span
                      aria-hidden
                      className="absolute bottom-7 left-6 top-7 w-px -translate-x-1/2 bg-border"
                    />
                  )}
                  {group.events.map((event) => (
                    <EventRow key={event.id} event={event} index={index++} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </div>
      </PageBody>
    </div>
  );
}
