import { forwardRef } from "react";
import type { LucideIcon } from "../lib/icons";
import { ChevronDownIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { controlBase, controlState } from "./Input";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  /** Leading icon inside the field. */
  icon?: LucideIcon;
  /** Classes for the outer wrapper (e.g. a fixed width in toolbars). */
  wrapperClassName?: string;
  selectSize?: "sm" | "md";
}

/** Native select with the shared control styling and a chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { error, icon: Icon, className, wrapperClassName, selectSize = "md", children, ...props },
    ref,
  ) => {
    return (
      <div className={cn("w-full", wrapperClassName)}>
        <div className="group/select relative">
          {Icon && (
            <Icon
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted",
                "transition-colors duration-150 group-focus-within/select:text-primary",
              )}
            />
          )}
          <select
            ref={ref}
            aria-invalid={error ? true : undefined}
            className={cn(
              controlBase,
              controlState(error),
              "cursor-pointer appearance-none truncate pr-9",
              selectSize === "sm" ? "h-8 pl-2.5 text-[13px]" : "h-9 pl-3",
              Icon && (selectSize === "sm" ? "pl-8" : "pl-9"),
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted",
              "transition-transform duration-200 group-focus-within/select:rotate-180 group-focus-within/select:text-primary",
            )}
          />
        </div>
        {error && <p className="mt-1.5 text-xs text-danger animate-slide-down">{error}</p>}
      </div>
    );
  },
);

Select.displayName = "Select";
