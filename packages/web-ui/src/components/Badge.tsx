import type { LucideIcon } from "../lib/icons";
import type { Tone } from "../lib/status";
import { TONE_DOT, taskStatusMeta, JOB_STATUS } from "../lib/status";
import type { RunnerJobStatus } from "../lib/api";
import { cn } from "../lib/cn";

/** Legacy variant names map onto tones. */
type LegacyVariant = "default" | "purple";

interface BadgeProps {
  tone?: Tone;
  /** @deprecated use `tone` */
  variant?: Tone | LegacyVariant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  dot?: boolean;
  /** Animated ring around the dot, for live states. */
  pulse?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

const toneStyles: Record<Tone, string> = {
  neutral: "bg-surface-tertiary/80 text-text-secondary ring-border",
  primary: "bg-primary/10 text-primary ring-primary/20",
  info: "bg-info/10 text-info ring-info/20",
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-warning/10 text-warning ring-warning/25",
  danger: "bg-danger/10 text-danger ring-danger/20",
  accent: "bg-accent/10 text-accent ring-accent/20",
};

const sizeStyles = {
  sm: "h-5 gap-1 px-1.5 text-[11px]",
  md: "h-6 gap-1.5 px-2 text-xs",
};

function resolveTone(tone?: Tone, variant?: Tone | LegacyVariant): Tone {
  if (tone) return tone;
  if (variant === "default" || !variant) return "neutral";
  if (variant === "purple") return "accent";
  return variant;
}

export function Badge({
  tone,
  variant,
  size = "sm",
  icon: Icon,
  dot = false,
  pulse = false,
  className,
  title,
  children,
}: BadgeProps) {
  const t = resolveTone(tone, variant);
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full font-medium leading-none",
        "ring-1 ring-inset transition-colors duration-200",
        toneStyles[t],
        sizeStyles[size],
        className,
      )}
    >
      {dot && <Dot tone={t} pulse={pulse} />}
      {Icon && !dot && (
        <Icon aria-hidden className={size === "sm" ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Colored status dot with an optional live pulse. */
export function Dot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex h-1.5 w-1.5 shrink-0", className)}>
      {pulse && (
        <span
          className={cn("absolute inset-0 rounded-full animate-pulse-ring", TONE_DOT[tone])}
          aria-hidden
        />
      )}
      <span className={cn("relative inline-flex h-full w-full rounded-full", TONE_DOT[tone])} />
    </span>
  );
}

/** Badge for a task workflow status, with its icon, tone and live pulse. */
export function StatusBadge({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const meta = taskStatusMeta(status);
  return (
    <Badge tone={meta.tone} size={size} dot={meta.live} pulse={meta.live} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

/** Badge for a runner job status. */
export function JobStatusBadge({
  status,
  size = "sm",
}: {
  status: RunnerJobStatus;
  size?: "sm" | "md";
}) {
  const meta = JOB_STATUS[status];
  return (
    <Badge tone={meta.tone} size={size} dot={meta.live} pulse={meta.live} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}
