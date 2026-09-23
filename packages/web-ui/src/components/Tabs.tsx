import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "../lib/icons";
import { cn } from "../lib/cn";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Small count shown after the label. */
  count?: ReactNode;
}

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  label: string;
  className?: string;
}

/** Underline tabs with a sliding indicator. */
export function Tabs<T extends string>({ value, onChange, items, label, className }: TabsProps<T>) {
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current.get(value);
    if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, items.length]);

  return (
    <div role="tablist" aria-label={label} className={cn("relative flex gap-1", className)}>
      {items.map((item) => {
        const selected = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            ref={(node) => {
              if (node) refs.current.set(item.value, node);
              else refs.current.delete(item.value);
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium",
              "transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60",
              selected ? "text-text" : "text-text-muted hover:text-text-secondary",
            )}
          >
            {Icon && (
              <Icon
                aria-hidden
                className={cn(
                  "h-4 w-4 transition-colors duration-200",
                  selected ? "text-primary" : "text-current",
                )}
              />
            )}
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums transition-colors duration-200",
                  selected ? "bg-primary/10 text-primary" : "bg-surface-tertiary text-text-muted",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
      {bar && (
        <span
          aria-hidden
          className="absolute -bottom-px h-0.5 rounded-full bg-primary transition-all duration-300 ease-out-expo"
          style={{ left: bar.left + 8, width: Math.max(0, bar.width - 16) }}
        />
      )}
    </div>
  );
}
