import type { ReactNode } from "react";
import type { LucideIcon } from "../lib/icons";
import { ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from "../lib/icons";
import { cn } from "../lib/cn";

type AlertTone = "info" | "success" | "warning" | "danger";

const ICONS: Record<AlertTone, LucideIcon> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  danger: ErrorIcon,
};

const STYLES: Record<AlertTone, string> = {
  info: "border-info/25 bg-info/[0.06] text-info",
  success: "border-success/25 bg-success/[0.06] text-success",
  warning: "border-warning/30 bg-warning/[0.07] text-warning",
  danger: "border-danger/25 bg-danger/[0.06] text-danger",
};

interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  icon?: LucideIcon;
  /** Right-aligned action (e.g. a small Button). */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Inline message box for errors, warnings and notes. */
export function Alert({ tone = "info", title, icon, action, className, children }: AlertProps) {
  const Icon = icon ?? ICONS[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm animate-slide-down",
        STYLES[tone],
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        {title && <div className="font-medium">{title}</div>}
        {children && (
          <div className={cn(!!title && "mt-0.5 opacity-90", "text-[13px]")}>{children}</div>
        )}
      </div>
      {action}
    </div>
  );
}
