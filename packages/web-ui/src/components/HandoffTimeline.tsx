import type { Handoff } from "../lib/api";
import { formatRelative } from "../lib/format";
import { Badge } from "./Badge";
import { EmptyState } from "./EmptyState";
import { ConversationIcon } from "../lib/icons";

const LISTS: [keyof Pick<Handoff, "decisions" | "risks" | "next">, string][] = [
  ["decisions", "Decisions"],
  ["risks", "Risks"],
  ["next", "Next"],
];

/** The notes each phase left for the next one, oldest first. */
export function HandoffTimeline({ handoffs }: { handoffs: Handoff[] }) {
  if (handoffs.length === 0) {
    return (
      <EmptyState
        compact
        icon={ConversationIcon}
        title="No handoffs yet"
        description="Each phase leaves notes here for the next one."
      />
    );
  }
  return (
    <ol className="space-y-3">
      {handoffs.map((h) => (
        <li key={h.id} className="rounded-lg border border-border-light px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={h.phase === "human" ? "primary" : "neutral"}>{h.phase}</Badge>
            {h.round > 0 && <span className="text-xs text-text-muted">round {h.round}</span>}
            <span className="truncate font-mono text-xs text-text-muted">{h.agentId}</span>
            <span className="ml-auto text-xs text-text-muted">{formatRelative(h.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-text-secondary">{h.summary}</p>
          {LISTS.map(([key, label]) =>
            h[key].length ? (
              <div key={key} className="mt-1">
                <span className="text-xs font-medium text-text-muted">{label}: </span>
                <span className="text-text-secondary">{h[key].join(" · ")}</span>
              </div>
            ) : null,
          )}
        </li>
      ))}
    </ol>
  );
}
