import { CheckIcon } from "../lib/icons";
import { cn } from "../lib/cn";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible label; shown as text when `showLabel` is set. */
  label: string;
  showLabel?: boolean;
  /** Mixed state (some but not all children selected). */
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Custom checkbox with an animated check. Stops click propagation so it works inside clickable cards. */
export function Checkbox({
  checked,
  onChange,
  label,
  showLabel = false,
  indeterminate = false,
  disabled = false,
  className,
}: CheckboxProps) {
  const on = checked || indeterminate;
  return (
    <label
      className={cn(
        "group/checkbox inline-flex shrink-0 items-center gap-2",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={showLabel ? undefined : label}
        aria-checked={indeterminate ? "mixed" : checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-[5px] border transition-all duration-150 ease-out",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-primary/60 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-surface",
          on
            ? "border-primary bg-primary text-primary-fg shadow-sm"
            : "border-border-strong bg-surface group-hover/checkbox:border-primary/60",
        )}
      >
        {indeterminate ? (
          <span className="h-0.5 w-2 rounded-full bg-current animate-pop" />
        ) : (
          checked && <CheckIcon className="h-3 w-3 animate-pop" strokeWidth={3} />
        )}
      </span>
      {showLabel && <span className="text-sm text-text">{label}</span>}
    </label>
  );
}
