import { forwardRef } from "react";
import type { LucideIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "danger-ghost" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. Replaced by a spinner while `loading`. */
  icon?: LucideIcon;
  /** Trailing icon. */
  iconRight?: LucideIcon;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover hover:shadow-glow " +
    "[background-image:linear-gradient(180deg,rgb(255_255_255/0.12),transparent)]",
  secondary:
    "border border-border bg-surface text-text shadow-xs hover:border-border-strong hover:bg-surface-secondary",
  ghost: "text-text-secondary hover:bg-surface-secondary hover:text-text",
  subtle: "bg-primary/10 text-primary hover:bg-primary/15",
  danger:
    "bg-danger text-danger-fg shadow-sm hover:bg-danger-hover " +
    "[background-image:linear-gradient(180deg,rgb(255_255_255/0.12),transparent)]",
  "danger-ghost": "text-danger hover:bg-danger/10",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-xs",
  md: "h-9 gap-2 rounded-lg px-3.5 text-sm",
  lg: "h-10 gap-2 rounded-xl px-5 text-sm",
};

const iconSize: Record<ButtonSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-4 w-4",
};

export const buttonBase =
  "group/button relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium " +
  "transition-all duration-150 ease-out active:scale-[0.97] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface " +
  "disabled:pointer-events-none disabled:opacity-50";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      icon: Icon,
      iconRight: IconRight,
      loading = false,
      className,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(buttonBase, buttonVariants[variant], sizeStyles[size], className)}
        {...props}
      >
        {loading ? (
          <Spinner className={iconSize[size]} />
        ) : (
          Icon && (
            <Icon
              aria-hidden
              className={cn(
                iconSize[size],
                "shrink-0 transition-transform duration-200 ease-out-expo",
              )}
            />
          )
        )}
        {children}
        {IconRight && !loading && (
          <IconRight
            aria-hidden
            className={cn(
              iconSize[size],
              "shrink-0 transition-transform duration-200 ease-out-expo group-hover/button:translate-x-0.5",
            )}
          />
        )}
      </button>
    );
  },
);

Button.displayName = "Button";
