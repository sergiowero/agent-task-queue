import { useId } from "react";
import type { LucideIcon } from "../lib/icons";
import { cn } from "../lib/cn";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  /** Secondary line under the label. */
  description?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  icon: Icon,
  disabled = false,
}: ToggleProps) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
      onClick={() => !disabled && onChange(!checked)}
    >
      {(label || description) && (
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />}
          <div className="min-w-0">
            {label && (
              <span id={id} className="block text-[13px] font-medium text-text">
                {label}
              </span>
            )}
            {description && <span className="block text-xs text-text-muted">{description}</span>}
          </div>
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? id : undefined}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onChange(!checked);
        }}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          checked ? "bg-primary" : "bg-border-strong",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300 ease-spring",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
