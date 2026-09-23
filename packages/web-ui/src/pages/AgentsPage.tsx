import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { Agent } from "../lib/api";
import { api } from "../lib/api";
import { AgentsIcon, ClearIcon, TerminalIcon, UserIcon } from "../lib/icons";
import { TONE_SOFT, TOOL_TONE } from "../lib/status";
import { formatDateTime, formatRelative } from "../lib/format";
import { cn } from "../lib/cn";
import { Badge, Dot } from "../components/Badge";
import { Button } from "../components/Button";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { CountPill, PageBody, PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { Skeleton } from "../components/Skeleton";

function isRecent(ts: string | null) {
  if (!ts) return false;
  return Date.now() - new Date(ts).getTime() < 5 * 60 * 1000;
}

/** Distinct values plus the active filter, so the select can always show it. */
function options(values: string[], current: string) {
  return [...new Set([...values, current].filter(Boolean))];
}

const COLUMNS = ["Agent", "Model", "Role", "Session", "Last seen"];
const CELL = "px-4 py-3";

function AgentRow({ agent, index }: { agent: Agent; index: number }) {
  const tone = TOOL_TONE[agent.toolName] ?? "neutral";
  const recent = isRecent(agent.lastSeen);
  return (
    <tr
      className="stagger group border-b border-border-light transition-colors duration-150 last:border-0 hover:bg-surface-secondary/60"
      style={{ "--i": index } as CSSProperties}
    >
      <td className={CELL}>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              TONE_SOFT[tone],
            )}
          >
            <AgentsIcon aria-hidden className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={tone}>{agent.toolName}</Badge>
              {agent.version && (
                <span className="text-xs text-text-muted">
                  {/^\d/.test(agent.version) ? `v${agent.version}` : agent.version}
                </span>
              )}
              {recent && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                  <Dot tone="success" pulse />
                  Active
                </span>
              )}
            </div>
            {agent.host && (
              <div className="mt-0.5 truncate text-xs text-text-muted" title={agent.host}>
                {agent.host}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className={cn(CELL, "font-mono text-xs text-text-secondary")}>{agent.model}</td>
      <td className={CELL}>
        <Badge>{agent.role}</Badge>
      </td>
      <td className={CELL}>
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-text-muted" title={agent.sessionId}>
            {agent.sessionId.slice(0, 8)}
          </span>
          <CopyButton
            value={agent.sessionId}
            label="Copy session ID"
            size="xs"
            className="opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100"
          />
        </div>
      </td>
      <td className={cn(CELL, "whitespace-nowrap text-xs text-text-muted")}>
        <span title={formatDateTime(agent.lastSeen)}>{formatRelative(agent.lastSeen)}</span>
      </td>
    </tr>
  );
}

function TableSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 border-b border-border bg-surface-secondary px-4 py-3">
        {COLUMNS.map((c) => (
          <Skeleton key={c} className="h-3 w-16" />
        ))}
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-border-light px-4 py-3 last:border-0"
        >
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function AgentsPage() {
  const [roleFilter, setRoleFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");

  const { data: agentsRes, isLoading } = useQuery({
    queryKey: ["agents", roleFilter, toolFilter],
    queryFn: () => api.getAgents({ role: roleFilter || undefined, tool: toolFilter || undefined }),
  });
  const agents = agentsRes?.data ?? [];

  const roles = options(
    agents.map((a) => a.role),
    roleFilter,
  );
  const tools = options(
    agents.map((a) => a.toolName),
    toolFilter,
  );
  const filtered = !!roleFilter || !!toolFilter;

  const clearFilters = () => {
    setRoleFilter("");
    setToolFilter("");
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        icon={AgentsIcon}
        title="Agents"
        description="Coding agents that registered through the CLI."
        meta={!isLoading && <CountPill>{agentsRes?.total ?? agents.length}</CountPill>}
        actions={
          <>
            <Select
              aria-label="Filter by role"
              icon={UserIcon}
              selectSize="sm"
              wrapperClassName="w-36"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by tool"
              icon={TerminalIcon}
              selectSize="sm"
              wrapperClassName="w-36"
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
            >
              <option value="">All tools</option>
              {tools.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            {filtered && (
              <IconButton
                icon={ClearIcon}
                label="Clear filters"
                className="animate-fade-in"
                onClick={clearFilters}
              />
            )}
          </>
        }
      />

      <PageBody>
        {isLoading && <TableSkeleton />}
        {!isLoading && agents.length === 0 && (
          <EmptyState
            icon={AgentsIcon}
            title={filtered ? "No agents match these filters" : "No agents registered yet"}
            description={
              filtered
                ? "Try another role or tool."
                : "Agents register when they claim a task via the CLI."
            }
            action={
              filtered && (
                <Button variant="secondary" icon={ClearIcon} onClick={clearFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        )}
        {agents.length > 0 && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-secondary">
                    {COLUMNS.map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className="eyebrow whitespace-nowrap px-4 py-2.5 text-left"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent, i) => (
                    <AgentRow key={agent.id} agent={agent} index={i} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </PageBody>
    </div>
  );
}
