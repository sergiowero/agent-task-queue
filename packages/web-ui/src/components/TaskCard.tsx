import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Badge } from "./Badge";

const STATUS_VARIANTS: Record<string, "default" | "success" | "warning" | "danger" | "info" | "purple"> = {
  plan_requested: "default",
  ready: "info",
  planning: "purple",
  coding: "info",
  reviewing: "warning",
  merging: "warning",
  complete: "success",
  merged: "success",
  canceled: "danger",
  waiting_plan_review: "warning",
  waiting_code_review: "warning",
  code_review_requested: "warning",
  changes_requested: "danger",
  plan_changes_requested: "danger",
  approved: "success",
};

interface TaskCardProps {
  task: any;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(task.priority));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  async function savePriority() {
    const parsed = parseInt(editValue, 10);
    if (isNaN(parsed)) {
      setEditValue(String(task.priority));
      setEditing(false);
      return;
    }
    if (parsed === task.priority) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.updateTask(task.id, { priority: parsed });
      setEditValue(String(parsed));
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch {
      setEditValue(String(task.priority));
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      savePriority();
    } else if (e.key === "Escape") {
      setEditValue(String(task.priority));
      setEditing(false);
    }
  }

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    setEditValue(String(task.priority));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function handleCardClick() {
    if (!editing) onClick();
  }

  function stopProp(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div
      onClick={handleCardClick}
      className="bg-surface rounded-xl border border-border p-3 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-150"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <h4 className="text-sm font-medium text-text line-clamp-2">{task.title}</h4>
        {editing ? (
          <span onMouseDown={stopProp} onClick={stopProp} className="shrink-0">
            <input
              ref={inputRef}
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={savePriority}
              onKeyDown={handleKeyDown}
              disabled={saving}
              className="w-16 text-xs border border-primary rounded-lg px-1.5 py-0.5 text-right bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-surface transition-all duration-150"
              autoFocus
            />
          </span>
        ) : (
          <span
            onClick={startEditing}
            className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all duration-150 ${saving ? "opacity-50" : ""} bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400`}
          >
            {saving ? "..." : `P${editValue}`}
          </span>
        )}
      </div>

      {task.recommendedBranch && (
        <div className="text-xs text-text-muted mb-1.5 truncate font-mono">
          {task.recommendedBranch}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant={STATUS_VARIANTS[task.status] ?? "default"}>
          {task.status.replace(/_/g, " ")}
        </Badge>

        {task.assignedAgent && (
          <span className="text-xs text-text-muted truncate">
            {task.assignedAgent.name}
          </span>
        )}
      </div>
    </div>
  );
}
