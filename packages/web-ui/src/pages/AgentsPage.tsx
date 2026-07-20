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
      <div className="h-14 border-b border-gray-200 bg-white flex items-center px-4 gap-4 shrink-0">
        <h2 className="font-semibold text-gray-900">Agents</h2>
        <div className="flex-1" />
        <select
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="">All roles</option>
          {roles.map((r: any) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          className="border border-gray-300 rounded px-2 py-1.5 text-sm"
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
        {isLoading && <p className="text-gray-400 text-sm">Loading...</p>}
        {!isLoading && agents.length === 0 && (
          <p className="text-gray-400 text-sm">No agents registered yet. Agents register when they claim a task via the CLI.</p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
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
                className={`border-b border-gray-100 ${isRecent(agent.lastSeen) ? "bg-green-50" : "bg-gray-50/50"}`}
              >
                <td className="py-2.5 font-medium text-gray-900">{agent.toolName}</td>
                <td className="py-2.5 text-gray-700">{agent.toolName}</td>
                <td className="py-2.5 text-gray-700 font-mono text-xs">{agent.model}</td>
                <td className="py-2.5">
                  <span className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{agent.role}</span>
                </td>
                <td className="py-2.5 text-gray-500 text-xs font-mono">{agent.sessionId.slice(0, 8)}</td>
                <td className="py-2.5 text-gray-500 text-xs">
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
