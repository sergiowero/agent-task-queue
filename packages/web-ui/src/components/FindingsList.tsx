import type { Finding } from "../lib/api";
import type { Tone } from "../lib/status";
import { Badge } from "./Badge";

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

/** Review findings grouped by round, newest round first, each with its id, severity and status. */
export function FindingsList({ findings }: { findings: Finding[] }) {
  const rounds = [...new Set(findings.map((f) => `${f.phase}:${f.round}`))].reverse();
  return (
    <div className="space-y-4">
      {rounds.map((key) => {
        const [phase, round] = key.split(":");
        const items = findings.filter((f) => `${f.phase}:${f.round}` === key);
        return (
          <div key={key}>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              {phase === "plan" ? "Plan review" : "Code review"} round {round}
            </h3>
            <ul className="space-y-2">
              {items.map((f) => (
                <li key={f.id} className="rounded-lg border border-border-light px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs text-text-muted">{f.id}</span>
                    <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                    <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
                    {f.reopenCount > 0 && <Badge tone="warning">reopened ×{f.reopenCount}</Badge>}
                    {f.file && (
                      <span className="truncate font-mono text-xs text-text-muted">
                        {f.file}
                        {f.line ? `:${f.line}` : ""}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-text-secondary">{f.text}</p>
                  {f.resolution && (
                    <p className="mt-1 text-xs text-text-muted">Resolution: {f.resolution}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
