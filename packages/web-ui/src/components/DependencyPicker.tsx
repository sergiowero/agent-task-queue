import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type Task } from "../lib/api";
import { CloseIcon, SearchIcon } from "../lib/icons";
import { StatusBadge } from "./Badge";
import { Checkbox } from "./Checkbox";
import { IconButton } from "./IconButton";
import { Input } from "./Input";

interface DependencyPickerProps {
  projectId: string;
  /** The task being edited: left out of the list (a new task has none). */
  taskId?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** Id of the search field (a Field label points at it). */
  id?: string;
}

/**
 * Picks the tasks of a project a task starts after. Canceled and complete tasks
 * are not offered (they will never complete, or add nothing); one already
 * chosen stays listed. The server refuses the rest (parents, subtasks, cycles).
 */
export function DependencyPicker({ projectId, taskId, value, onChange, disabled, id }: DependencyPickerProps) {
  const [search, setSearch] = useState("");
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", "all", projectId],
    queryFn: () => api.getAllTasks(projectId),
    enabled: !!projectId,
  });
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(
      (t: Task) =>
        t.id !== taskId &&
        (value.includes(t.id) || (t.status !== "canceled" && t.status !== "complete")) &&
        (!q || t.title.toLowerCase().includes(q) || t.id.startsWith(q)),
    );
  }, [tasks, taskId, value, search]);

  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));

  if (!projectId) return <p className="text-xs text-text-muted">Select a project first.</p>;
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Starts after">
          {value.map((dep) => (
            <li
              key={dep}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-light bg-surface-secondary py-0.5 pl-2 pr-0.5 text-xs"
            >
              <span className="truncate">{byId.get(dep)?.title ?? <span className="font-mono">{dep.slice(0, 8)}</span>}</span>
              <IconButton icon={CloseIcon} label="Remove dependency" size="xs" disabled={disabled} onClick={() => toggle(dep, false)} />
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        inputSize="sm"
        icon={SearchIcon}
        aria-label="Search tasks"
        placeholder="Search tasks by title"
        value={search}
        disabled={disabled}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="max-h-48 overflow-y-auto rounded-lg border border-border-light">
        {isLoading ? (
          <p className="px-3 py-2 text-xs text-text-muted">Loading tasks…</p>
        ) : options.length === 0 ? (
          <p className="px-3 py-2 text-xs text-text-muted">No tasks to start after.</p>
        ) : (
          <ul className="divide-y divide-border-light">
            {options.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                <Checkbox
                  checked={value.includes(t.id)}
                  onChange={(on) => toggle(t.id, on)}
                  label={t.title}
                  showLabel
                  disabled={disabled}
                  className="min-w-0 flex-1 [&>span:last-child]:truncate"
                />
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
