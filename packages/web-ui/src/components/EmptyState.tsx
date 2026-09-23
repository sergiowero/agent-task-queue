import type { ReactNode } from "react";
import type { LucideIcon } from "../lib/icons";
import { EmptyIcon } from "../lib/icons";
import { cn } from "../lib/cn";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Usually a primary Button. */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon = EmptyIcon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 text-center animate-rise",
        compact ? "py-10" : "py-20",
        className,
      )}
    >
      <div className="relative mb-4">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/10 blur-2xl"
        />
        <div
          className={cn(
            "flex items-center justify-center rounded-2xl border border-border bg-surface text-text-muted shadow-sm",
            compact ? "h-11 w-11" : "h-14 w-14",
          )}
        >
          <Icon aria-hidden className={compact ? "h-5 w-5" : "h-6 w-6"} strokeWidth={1.75} />
        </div>
      </div>
      <h3 className={cn("font-semibold text-text", compact ? "text-sm" : "text-base")}>{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
