import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Task } from "../lib/api";
import { CloseIcon, EditIcon, SaveIcon } from "../lib/icons";
import { StatusBadge } from "./Badge";
import { Button } from "./Button";
import { DependencyPicker } from "./DependencyPicker";
import { IconButton } from "./IconButton";

interface TaskDependenciesProps {
  task: Task;
  editable: boolean;
  onSave: (blockedBy: string[]) => Promise<unknown>;
}

/** The tasks a task starts after, with their status; a person edits the list where the task is editable. */
export function TaskDependencies({ task, editable, onSave }: TaskDependenciesProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", "all", task.projectId ?? ""],
    queryFn: () => api.getAllTasks(task.projectId ?? undefined),
    enabled: task.blockedBy.length > 0 && !!task.projectId,
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const pending = task.blockedBy.filter((id) => byId.get(id)?.status !== "complete" && byId.has(id)).length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="group/field mt-1">
      <div className="flex h-6 items-center gap-2 text-sm text-text-secondary">
        <span>Starts after</span>
        {!editing && pending > 0 && (
          <span className="text-xs text-text-muted">
            {task.parentId ? "· no agent takes it" : "· nobody codes it"} until {pending === 1 ? "it is" : `all ${pending} are`} complete
          </span>
        )}
        {editable && !editing && task.projectId && (
          <IconButton
            icon={EditIcon}
            label="Edit dependencies"
            size="xs"
            className="ml-auto"
            onClick={() => {
              setDraft(task.blockedBy);
              setError(null);
              setEditing(true);
            }}
          />
        )}
      </div>
      {editing && task.projectId ? (
        <div className="mt-2 space-y-2.5 animate-slide-down">
          <DependencyPicker projectId={task.projectId} taskId={task.id} value={draft} onChange={setDraft} disabled={saving} />
          {error && <p className="text-xs text-danger animate-slide-down">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" icon={CloseIcon} onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" icon={SaveIcon} loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : task.blockedBy.length === 0 ? (
        <p className="text-xs text-text-muted">No dependencies.</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {task.blockedBy.map((id) => {
            const dep = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-2 text-sm">
                {dep && <StatusBadge status={dep.status} />}
                <Link className="truncate hover:underline" to={`/tasks/${id}/details`}>
                  {dep?.title ?? <span className="font-mono text-xs">{id.slice(0, 8)}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
