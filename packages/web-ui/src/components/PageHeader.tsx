import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "../lib/icons";
import { BackIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Back button before the title, e.g. `{ to: "/board", label: "Back to board" }`. */
  back?: { to: string; label: string };
  /** Right-aligned actions (primary button last). */
  actions?: ReactNode;
  /** Count or status next to the title. */
  meta?: ReactNode;
  /** Optional toolbar row (search, filters) under the title row. */
  toolbar?: ReactNode;
  className?: string;
}

/** Top bar of every page: icon, title, description, actions, optional toolbar. */
export function PageHeader({
  title,
  description,
  icon: Icon,
  back,
  actions,
  meta,
  toolbar,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        "sticky top-0 z-20 shrink-0 border-b border-border bg-surface/80 backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex min-h-16 items-center gap-4 px-6 py-3">
        {back && (
          <IconButton
            icon={BackIcon}
            label={back.label}
            variant="secondary"
            tooltipSide="bottom"
            onClick={() => navigate(back.to)}
            className="-mr-1"
          />
        )}
        {Icon && (
          <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-accent/10 text-primary ring-1 ring-inset ring-primary/15 sm:flex">
            <Icon aria-hidden className="h-[18px] w-[18px]" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[17px] font-semibold tracking-tight text-text">{title}</h1>
            {meta}
          </div>
          {description && (
            <p className="hidden truncate text-[13px] text-text-muted md:block">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-light px-6 py-2.5">
          {toolbar}
        </div>
      )}
    </header>
  );
}

/** Scrollable page body with consistent padding. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex-1 overflow-auto px-6 py-6", className)}>{children}</div>;
}

/** Number pill next to a title. */
export function CountPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-tertiary px-1.5 text-[11px] font-semibold tabular-nums text-text-secondary transition-colors duration-200">
      {children}
    </span>
  );
}
