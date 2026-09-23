import { forwardRef } from "react";
import type { LucideIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";
import { Tooltip } from "./Tooltip";

export type IconButtonVariant = "ghost" | "secondary" | "primary" | "danger";
export type IconButtonSize = "xs" | "sm" | "md";

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** Accessible name; also shown as the tooltip. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
  /** Pressed/selected look for toggle-style buttons. */
  active?: boolean;
  tooltip?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

const variantStyles: Record<IconButtonVariant, string> = {
  ghost: "text-text-muted hover:bg-surface-tertiary/70 hover:text-text",
  secondary:
    "border border-border bg-surface text-text-secondary shadow-xs hover:border-border-strong hover:bg-surface-secondary hover:text-text",
  primary: "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover hover:shadow-glow",
  danger: "text-text-muted hover:bg-danger/10 hover:text-danger",
};

const sizeStyles: Record<IconButtonSize, { box: string; icon: string }> = {
  xs: { box: "h-6 w-6 rounded-md", icon: "h-3.5 w-3.5" },
  sm: { box: "h-8 w-8 rounded-lg", icon: "h-4 w-4" },
  md: { box: "h-9 w-9 rounded-lg", icon: "h-[18px] w-[18px]" },
};

/** Square, icon-only button. Always labelled for screen readers and via tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon: Icon,
      label,
      variant = "ghost",
      size = "sm",
      loading = false,
      active = false,
      tooltip = true,
      tooltipSide = "top",
      className,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const s = sizeStyles[size];
    return (
      <Tooltip content={label} side={tooltipSide} disabled={!tooltip}>
        <button
          ref={ref}
          type={type}
          aria-label={label}
          aria-pressed={active || undefined}
          disabled={disabled || loading}
          className={cn(
            "inline-flex shrink-0 items-center justify-center transition-all duration-150 ease-out",
            "active:scale-90 disabled:pointer-events-none disabled:opacity-40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            s.box,
            variantStyles[variant],
            active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            className,
          )}
          {...props}
        >
          {loading ? <Spinner className={s.icon} /> : <Icon aria-hidden className={s.icon} />}
        </button>
      </Tooltip>
    );
  },
);

IconButton.displayName = "IconButton";
