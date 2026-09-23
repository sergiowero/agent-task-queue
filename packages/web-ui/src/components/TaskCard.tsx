import type { Task } from "../lib/api";
import { AgentsIcon, BranchIcon, DeleteIcon, PriorityIcon } from "../lib/icons";
import { priorityTone } from "../lib/status";
import { cn } from "../lib/cn";
import { Badge, StatusBadge } from "./Badge";
import { Checkbox } from "./Checkbox";
import { IconButton } from "./IconButton";

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  onDelete?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function TaskCard({
  task,
  onClick,
  onDelete,
  selected = false,
  onToggleSelect,
}: TaskCardProps) {
  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={task.title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === "Enter") onClick();
      }}
      className={cn(
        "card-interactive group bg-surface-elevated p-3",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        selected &&
          "border-primary/50 ring-2 ring-primary/20 [background-image:linear-gradient(rgb(var(--primary)/0.04),rgb(var(--primary)/0.04))]",
      )}
    >
      <div className="flex items-start gap-2.5">
        {onToggleSelect && (
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect()}
            label={`Select ${task.title}`}
            className="mt-0.5"
          />
        )}
        <h4 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug text-text">
          {task.title}
        </h4>
        <Badge
          tone={priorityTone(task.priority)}
          icon={PriorityIcon}
          title={`Priority ${task.priority}`}
        >
          P{task.priority}
        </Badge>
      </div>

      {task.recommendedBranch && (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-text-muted">
          <BranchIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-mono text-xs">{task.recommendedBranch}</span>
        </div>
      )}

      <div className="mt-3 flex min-h-6 items-center gap-2">
        <StatusBadge status={task.status} />
        {task.assignedAgent && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
            <AgentsIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{task.assignedAgent.name}</span>
          </span>
        )}
        {onDelete && (
          <IconButton
            icon={DeleteIcon}
            label="Delete task"
            variant="danger"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={cn(
              "-mr-1 ml-auto opacity-0",
              "focus-visible:opacity-100 group-hover:opacity-100 group-focus-visible:opacity-100",
              "[@media(hover:none)]:opacity-100",
            )}
          />
        )}
      </div>
    </div>
  );
}
