import { forwardRef } from "react";
import type { LucideIcon } from "../lib/icons";
import { cn } from "../lib/cn";

/** Shared look for text inputs, textareas and selects. */
export const controlBase =
  "w-full rounded-lg border bg-surface text-sm text-text shadow-xs placeholder:text-text-muted " +
  "transition-[border-color,box-shadow,background-color] duration-150 ease-out " +
  "hover:border-border-strong focus:outline-none focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:opacity-60";

export function controlState(error?: string | boolean) {
  return error
    ? "border-danger/70 focus:border-danger focus:ring-4 focus:ring-danger/15"
    : "border-border focus:border-primary/70 focus:ring-4 focus:ring-primary/15";
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  /** Leading icon inside the field. */
  icon?: LucideIcon;
  /** Element rendered at the right edge inside the field (e.g. a clear button). */
  trailing?: React.ReactNode;
  /** Classes for the outer wrapper. */
  wrapperClassName?: string;
  inputSize?: "sm" | "md";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { error, icon: Icon, trailing, className, wrapperClassName, inputSize = "md", ...props },
    ref,
  ) => {
    return (
      <div className={cn("w-full", wrapperClassName)}>
        <div className="group/input relative">
          {Icon && (
            <Icon
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted",
                "transition-colors duration-150 group-focus-within/input:text-primary",
              )}
            />
          )}
          <input
            ref={ref}
            aria-invalid={error ? true : undefined}
            className={cn(
              controlBase,
              controlState(error),
              inputSize === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3",
              Icon && "pl-9",
              trailing ? "pr-9" : undefined,
              className,
            )}
            {...props}
          />
          {trailing && (
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
              {trailing}
            </div>
          )}
        </div>
        {error && <p className="mt-1.5 text-xs text-danger animate-slide-down">{error}</p>}
      </div>
    );
  },
);

Input.displayName = "Input";
