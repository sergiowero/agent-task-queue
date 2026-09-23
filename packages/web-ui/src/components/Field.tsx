import { useId, cloneElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LucideIcon } from "../lib/icons";
import { cn } from "../lib/cn";

interface FieldProps {
  label: ReactNode;
  required?: boolean;
  /** Help text under the control. */
  hint?: ReactNode;
  /** Tints the hint (e.g. a warning about a risky setting). */
  hintTone?: "muted" | "warning" | "danger";
  icon?: LucideIcon;
  /** Right side of the label row (e.g. a small action). */
  aside?: ReactNode;
  className?: string;
  /** A single form control; it receives the generated id. */
  children: ReactNode;
}

/** Label + control + hint, the standard form row. */
export function Field({
  label,
  required,
  hint,
  hintTone = "muted",
  icon: Icon,
  aside,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const child =
    isValidElement(children) && !(children.props as { id?: string }).id
      ? cloneElement(children as ReactElement<{ id?: string }>, { id })
      : children;
  const controlId =
    isValidElement(children) && (children.props as { id?: string }).id
      ? (children.props as { id?: string }).id
      : id;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={controlId}
          className="flex items-center gap-1.5 text-[13px] font-medium text-text"
        >
          {Icon && <Icon aria-hidden className="h-3.5 w-3.5 text-text-muted" />}
          {label}
          {required && (
            <span className="text-danger" aria-hidden>
              *
            </span>
          )}
        </label>
        {aside && <div className="-my-1 flex items-center">{aside}</div>}
      </div>
      {child}
      {hint && (
        <p
          className={cn(
            "text-xs leading-relaxed transition-colors duration-200",
            hintTone === "warning" && "text-warning",
            hintTone === "danger" && "text-danger",
            hintTone === "muted" && "text-text-muted",
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
