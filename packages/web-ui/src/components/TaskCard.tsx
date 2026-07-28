import { useState, useRef, useEffect, type KeyboardEvent, type MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Badge } from "./Badge";
import { DeleteTaskModal } from "./DeleteTaskModal";
import type { Task } from "../lib/api";

const STATUS_LABELS: Record<string, string> = {
  plan_requested: "Plan Requested",
  planning: "Planning",
  ready_for_code: "Ready for Code",
  coding: "Coding",
  waiting_plan_review: "Waiting Plan Review",
  waiting_code_review: "Waiting Code Review",
  code_review_requested: "Code Review Requested",
  reviewing: "Reviewing",
  changes_requested: "Changes Requested",
  plan_changes_requested: "Plan Changes Requested",
  approved: "Approved",
  merging: "Merging",
  merged: "Merged",
  complete: "Complete",
  canceled: "Canceled",
};

const STATUS_VARIANTS: Record<
  string,
  "default" | "success" | "warning" | "danger" | "info" | "purple"
> = {
  plan_requested: "default",
  ready_for_code: "info",
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
  task: Task;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(task.priority));
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

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

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      savePriority();
    } else if (e.key === "Escape") {
      setEditValue(String(task.priority));
      setEditing(false);
    }
  }

  function startEditing(e: MouseEvent) {
    e.stopPropagation();
    setEditValue(String(task.priority));
    setEditing(true);
    rafRef.current = requestAnimationFrame(() => inputRef.current?.select());
  }

  function handleCardClick() {
    if (!editing) onClick();
  }

  function stopProp(e: MouseEvent) {
    e.stopPropagation();
  }

  function handleDeleteClick(e: MouseEvent) {
    e.stopPropagation();
    setShowDeleteModal(true);
  }

  const canDelete = ![
    "coding", "waiting_code_review", "code_review_requested",
    "reviewing", "changes_requested", "approved", "merging",
    "merged", "complete", "canceled",
  ].includes(task.status);

  return (
    <div
      onClick={handleCardClick}
      className="bg-surface rounded-xl border border-border p-3 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-150 group"
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
        {canDelete && (
          <button
            onClick={handleDeleteClick}
            className="shrink-0 text-text-muted hover:text-danger transition-colors duration-150 p-0.5"
            title="Delete task"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 000 1.5h.3l.815 8.15A1.5 1.5 0 005.357 15h5.286a1.5 1.5 0 001.492-1.35l.815-8.15h.3a.75.75 0 000-1.5H11v-.75A2.25 2.25 0 008.75 1h-1.5A2.25 2.25 0 005 3.25zm2.25-.75a.75.75 0 00-.75.75V4h3v-.75a.75.75 0 00-.75-.75h-1.5zM6.166 6.5a.75.75 0 01.75.75l-.167 5a.75.75 0 01-1.498-.062l.166-5a.75.75 0 01.749-.688zm3.668 0a.75.75 0 01.75.75l-.167 5a.75.75 0 01-1.498-.062l.166-5a.75.75 0 01.749-.688z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>

      {task.recommendedBranch && (
        <div className="text-xs text-text-muted mb-1.5 truncate font-mono">
          {task.recommendedBranch}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant={STATUS_VARIANTS[task.status] ?? "default"}>
          {STATUS_LABELS[task.status] ?? task.status.replace(/_/g, " ")}
        </Badge>

        {task.assignedAgent && (
          <span className="text-xs text-text-muted truncate">{task.assignedAgent.name}</span>
        )}
      </div>

      {showDeleteModal && (
        <DeleteTaskModal task={task} onClose={() => setShowDeleteModal(false)} />
      )}
    </div>
  );
}
