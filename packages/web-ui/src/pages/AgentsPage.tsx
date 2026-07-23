import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { Skeleton } from "../components/Skeleton";

function isRecent(ts: string | null) {
  if (!ts) return false;
  return Date.now() - new Date(ts).getTime() < 5 * 60 * 1000;
}

export function AgentsPage() {
  const [roleFilter, setRoleFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents", roleFilter, toolFilter],
    queryFn: () => api.getAgents({ role: roleFilter || undefined, tool: toolFilter || undefined }),
  });

  const roles = [...new Set(agents.map((a: any) => a.role))];
  const tools = [...new Set(agents.map((a: any) => a.toolName))];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Agents</h2>
        <div className="flex-1" />
        <select
          className="border border-border bg-surface-secondary text-text rounded-lg px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all duration-150"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="">All roles</option>
          {roles.map((r: any) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          className="border border-border bg-surface-secondary text-text rounded-lg px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all duration-150"
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
        >
          <option value="">All tools</option>
          {tools.map((t: any) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-4 p-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        )}
        {!isLoading && agents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            <p className="text-sm">No agents registered yet.</p>
            <p className="text-xs mt-1">Agents register when they claim a task via the CLI.</p>
          </div>
        )}
        {agents.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Tool</th>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Session</th>
                <th className="pb-2 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent: any) => (
                <tr
                  key={agent.id}
                  className={`border-b border-border ${isRecent(agent.lastSeen) ? "bg-green-50/50 dark:bg-green-900/20" : "bg-surface-secondary"}`}
                >
                  <td className="py-2.5 font-medium text-text">{agent.toolName}</td>
                  <td className="py-2.5 text-text-secondary">{agent.toolName}</td>
                  <td className="py-2.5 text-text-secondary font-mono text-xs">{agent.model}</td>
                  <td className="py-2.5">
                    <span className="text-xs bg-surface-secondary text-text-secondary px-1.5 py-0.5 rounded">{agent.role}</span>
                  </td>
                  <td className="py-2.5 text-text-muted text-xs font-mono">{agent.sessionId.slice(0, 8)}</td>
                  <td className="py-2.5 text-text-muted text-xs">
                    {agent.lastSeen ? new Date(agent.lastSeen).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
