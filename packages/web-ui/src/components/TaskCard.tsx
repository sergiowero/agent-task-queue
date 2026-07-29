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

const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
  1: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800",
  2: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  3: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700",
};

interface TaskCardProps {
  task: any;
  onClick: () => void;
  onEdit?: () => void;
}

export function TaskCard({ task, onClick, onEdit }: TaskCardProps) {
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
      className="bg-surface rounded-xl border border-border p-3 cursor-pointer hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-150"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="text-sm font-semibold text-text line-clamp-2 leading-snug">{task.title}</h4>
        <div className="flex items-center gap-1 shrink-0">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-secondary transition-colors"
              title="Edit task"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
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
                className="w-16 text-xs border border-primary rounded-lg px-1.5 py-0.5 text-right bg-surface text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface transition-all duration-150"
                autoFocus
              />
            </span>
          ) : (
            <span
              onClick={startEditing}
              className={`text-xs px-1.5 py-0.5 rounded shrink-0 cursor-pointer border font-medium hover:ring-2 hover:ring-primary/30 transition-all duration-150 ${saving ? "opacity-50" : ""} ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS[3]}`}
            >
              {saving ? "..." : `P${editValue}`}
            </span>
          )}
        </div>
      </div>

      {task.recommendedBranch && (
        <div className="text-xs text-text-muted mb-1.5 truncate font-mono">
          {task.recommendedBranch}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant={STATUS_VARIANTS[task.status] ?? "default"} dot>
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
