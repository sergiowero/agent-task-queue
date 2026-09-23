import { useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { Tooltip } from "./Tooltip";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Hide the text and show it as a tooltip instead. */
  iconOnly?: boolean;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T, event: React.MouseEvent<HTMLButtonElement>) => void;
  options: SegmentOption<T>[];
  size?: "sm" | "md";
  /** Stretch segments to fill the width. */
  fullWidth?: boolean;
  /** Accessible name for the group. */
  label: string;
  className?: string;
}

/** Pill-style single choice with a sliding thumb. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  fullWidth = false,
  label,
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value);
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    const el = refs.current.get(value);
    if (el?.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [value, options.length]);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative inline-flex items-center rounded-lg bg-surface-tertiary/70 p-0.5 ring-1 ring-inset ring-border/60",
        fullWidth && "flex w-full",
        className,
      )}
    >
      {thumb && (
        <span
          aria-hidden
          className="absolute bottom-0.5 top-0.5 rounded-md bg-surface shadow-sm ring-1 ring-border/70 transition-all duration-300 ease-out-expo"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {options.map((opt) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        const button = (
          <button
            key={opt.value}
            ref={(node) => {
              if (node) refs.current.set(opt.value, node);
              else refs.current.delete(opt.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.iconOnly ? opt.label : undefined}
            onClick={(e) => onChange(opt.value, e)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-md font-medium",
              "transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
              opt.iconOnly && (size === "sm" ? "w-7 px-0" : "w-8 px-0"),
              fullWidth && "flex-1",
              selected ? "text-text" : "text-text-muted hover:text-text-secondary",
            )}
          >
            {Icon && (
              <Icon
                aria-hidden
                className={cn(
                  size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
                  "transition-transform duration-300 ease-spring",
                  selected && "scale-110",
                )}
              />
            )}
            {!opt.iconOnly && opt.label}
          </button>
        );
        return opt.iconOnly ? (
          <Tooltip key={opt.value} content={opt.label}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
