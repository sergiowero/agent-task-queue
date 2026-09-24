import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { inboxReason, type InboxReason } from "@agentq/shared/catalog";
import { api } from "../lib/api";
import type { Task } from "../lib/api";
import { useSSE } from "../hooks/useSSE";
import { ChevronRightIcon, ExternalLinkIcon, InboxIcon } from "../lib/icons";
import { formatDateTime, formatRelative } from "../lib/format";
import { Badge, StatusBadge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { CountPill, PageBody, PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { Skeleton } from "../components/Skeleton";

interface Item {
  task: Task;
  reason: InboxReason;
  /** When the task started waiting: its last status change. */
  since: string;
}

const GROUPS: { priority: number; label: string }[] = [
  { priority: 0, label: "Blocked, waiting for an answer" },
  { priority: 1, label: "Plans to approve" },
  { priority: 2, label: "Code to review" },
  { priority: 3, label: "Pull requests to merge" },
  { priority: 4, label: "Drafts that are not ready" },
];

function waitingSince(task: Task): string {
  return task.history?.at(-1)?.timestamp ?? task.updatedAt;
}

/** Every task waiting for a person, grouped by what they need to do, oldest first. */
export function InboxPage() {
  const [projectId, setProjectId] = useState("");
  const queryClient = useQueryClient();
  useSSE(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }, [queryClient]),
  );

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", "all", projectId],
    queryFn: () => api.getAllTasks(projectId || undefined),
  });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: api.getProjects });

  const items = useMemo(() => {
    const list: Item[] = [];
    for (const task of tasks ?? []) {
      const reason = inboxReason(task);
      if (reason) list.push({ task, reason, since: waitingSince(task) });
    }
    return list.sort((a, b) => a.reason.priority - b.reason.priority || a.since.localeCompare(b.since));
  }, [tasks]);

  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.displayName;
  let index = 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        icon={InboxIcon}
        title="Needs you"
        description="Decisions only a person can make, oldest first. Everything else moves on by itself."
        meta={!isLoading && <CountPill>{items.length}</CountPill>}
        actions={
          <Select
            selectSize="sm"
            aria-label="Project"
            wrapperClassName="w-48"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </Select>
        }
      />
      <PageBody>
        <div className="mx-auto max-w-3xl space-y-6">
          {isLoading &&
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          {!isLoading && items.length === 0 && (
            <EmptyState
              icon={InboxIcon}
              title="Nothing needs you"
              description="Agents are working, or the queue is empty."
            />
          )}
          {GROUPS.map((group) => {
            const groupItems = items.filter((i) => i.reason.priority === group.priority);
            if (groupItems.length === 0) return null;
            return (
              <section key={group.priority} aria-label={group.label}>
                <h2 className="eyebrow mb-2 flex items-center gap-2">
                  {group.label}
                  <CountPill>{groupItems.length}</CountPill>
                </h2>
                <ul className="space-y-2">
                  {groupItems.map(({ task, reason, since }) => (
                    <li key={task.id} className="stagger" style={{ "--i": index++ } as CSSProperties}>
                      {/* The title link covers the card; the PR link sits above it. */}
                      <div className="card group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-secondary">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <Link
                              to={`/tasks/${task.id}/details`}
                              className="truncate font-medium after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary/60"
                            >
                              {task.title}
                            </Link>
                            <StatusBadge status={task.status} />
                            {task.risk === "high" && <Badge tone="danger">high risk</Badge>}
                          </div>
                          <p className="mt-0.5 truncate text-sm text-text-secondary">{reason.action}</p>
                          <p className="mt-0.5 text-xs text-text-muted" title={formatDateTime(since)}>
                            {projectName(task.projectId) ?? "No project"} · waiting since {formatRelative(since)}
                          </p>
                        </div>
                        {task.pullRequest?.url && (
                          <a
                            href={task.pullRequest.url}
                            target="_blank"
                            rel="noreferrer"
                            className="relative z-10 inline-flex items-center gap-1 text-xs text-primary underline"
                          >
                            PR{task.pullRequest.number ? ` #${task.pullRequest.number}` : ""}
                            <ExternalLinkIcon aria-hidden className="h-3 w-3" />
                          </a>
                        )}
                        <ChevronRightIcon
                          aria-hidden
                          className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </PageBody>
    </div>
  );
}
