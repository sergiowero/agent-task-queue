import type { ReactNode } from "react";
import type { Finding } from "../lib/api";
import type { Tone } from "../lib/status";
import { cn } from "../lib/cn";
import { Badge } from "./Badge";
import { Checkbox } from "./Checkbox";

const SEVERITY_TONE: Record<Finding["severity"], Tone> = {
  blocker: "danger",
  major: "warning",
  minor: "info",
  nit: "neutral",
};

const STATUS_TONE: Record<Finding["status"], Tone> = {
  open: "danger",
  fixed: "info",
  wontfix: "neutral",
  verified: "success",
};

interface FindingChecklistProps {
  findings: Finding[];
  /** Findings the person reopens with their answer. */
  reopen: string[];
  onToggleReopen: (id: string) => void;
  /** Whether a ticked box reopens anything: false while the person's answer does not send the task back. */
  canReopen?: boolean;
  /**
   * Answering a blocked task: open findings the person accepts as they are,
   * instead of sending them back with the task.
   */
  accepted?: string[];
  onToggleAccept?: (id: string) => void;
}

/** A labeled on/off choice on one finding (Accept, Reopen). */
function Choice({
  pressed,
  disabled,
  label,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  label: string;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-6 w-[4.5rem] shrink-0 rounded-full border text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        pressed
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-surface text-text-secondary hover:border-border-strong",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Findings to decide on. An answered one (fixed, wontfix, verified) can be
 * reopened so its author answers again; an open one already goes back with the
 * task, unless the person accepts it (only when answering a blocked task).
 * The author's answer is shown with each finding, so a dispute can be judged.
 */
export function FindingChecklist({
  findings,
  reopen,
  onToggleReopen,
  canReopen = true,
  accepted,
  onToggleAccept,
}: FindingChecklistProps) {
  // Answering a blocked task: each finding gets a labeled choice instead of a bare box.
  const answering = !!onToggleAccept;
  return (
    <ul className="space-y-1.5">
      {findings.map((f) => (
        <li key={f.id} className="text-sm">
          <div className="flex items-start gap-2">
            {answering && f.status === "open" ? (
              <Choice
                pressed={accepted?.includes(f.id) ?? false}
                label={`Accept ${f.id} as it is`}
                title="Close it as accepted: nobody has to fix it. Left alone, it goes back with the task."
                onClick={() => onToggleAccept(f.id)}
              >
                Accept
              </Choice>
            ) : answering ? (
              <Choice
                pressed={reopen.includes(f.id)}
                disabled={!canReopen}
                label={`Reopen ${f.id}`}
                title={canReopen ? "Have it answered again with the task" : "Send the task back to reopen a finding"}
                onClick={() => onToggleReopen(f.id)}
              >
                Reopen
              </Choice>
            ) : (
              <span title={f.status === "open" ? "Still open: it goes back with the task" : undefined}>
                <Checkbox
                  label={`Reopen ${f.id}`}
                  checked={f.status === "open" || reopen.includes(f.id)}
                  disabled={f.status === "open"}
                  onChange={() => onToggleReopen(f.id)}
                  className="mt-0.5"
                />
              </span>
            )}
            <span className="font-mono text-xs text-text-muted">{f.id}</span>
            <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
            <span className="min-w-0 flex-1 line-clamp-3 text-text-secondary" title={f.text}>
              {f.text}
            </span>
            {f.reopenCount > 0 && <Badge tone="warning">reopened ×{f.reopenCount}</Badge>}
            <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
          </div>
          {f.resolution && (
            <p className={cn("mt-0.5 whitespace-pre-wrap text-xs text-text-muted", answering ? "ml-[5rem]" : "ml-6")}>
              Answer: {f.resolution}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
