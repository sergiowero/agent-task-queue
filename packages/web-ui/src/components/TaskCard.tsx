import { Badge } from "./Badge";

const STATUS_VARIANTS: Record<string, "default" | "success" | "warning" | "danger" | "info" | "purple"> = {
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

const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
  1: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800",
  2: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  3: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700",
};

interface TaskCardProps {
  task: any;
  onClick: () => void;
  onDelete?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function TaskCard({ task, onClick, onDelete, selected, onToggleSelect }: TaskCardProps) {
  function stopProp(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div
      onClick={onClick}
      className={`bg-surface rounded-xl border p-3 cursor-pointer hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-150 ${
        selected ? "border-primary/60 ring-1 ring-primary/40" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect()}
            onClick={stopProp}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
            title="Select task"
          />
        )}
        <h4 className="text-sm font-semibold text-text line-clamp-2 leading-snug">{task.title}</h4>
        <div className="flex items-center gap-1 shrink-0">
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              title="Delete task"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <span
            className={`text-xs px-1.5 py-0.5 rounded shrink-0 border font-medium ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS[3]}`}
          >
            P{task.priority}
          </span>
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