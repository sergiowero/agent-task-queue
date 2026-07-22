import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";

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
          className="border border-border bg-surface-secondary text-text rounded px-2 py-1.5 text-sm"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="">All roles</option>
          {roles.map((r: any) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          className="border border-border bg-surface-secondary text-text rounded px-2 py-1.5 text-sm"
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
        {isLoading && <p className="text-text-muted text-sm">Loading...</p>}
        {!isLoading && agents.length === 0 && (
          <p className="text-text-muted text-sm">No agents registered yet. Agents register when they claim a task via the CLI.</p>
        )}
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
      </div>
    </div>
  );
}
