import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { FlowMetrics } from "../lib/api";
import type { Tone } from "../lib/status";
import { TONE_TEXT } from "../lib/status";
import { MetricsIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { Skeleton } from "./Skeleton";

interface Metric {
  key: keyof FlowMetrics;
  label: string;
  hint: string;
  format: (v: number) => string;
  /** Green when the value meets the target, amber otherwise; null when there is no target. */
  good?: (v: number) => boolean;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => (Math.round(v * 10) / 10).toString();

const METRICS: Metric[] = [
  { key: "humanClicksPerTask", label: "Human decisions per task", hint: "Target at L2: 2 or fewer", format: num, good: (v) => v <= 2 },
  { key: "reachedPrWithoutHuman", label: "Reached the PR without a person", hint: "Target: above 70%", format: pct, good: (v) => v > 0.7 },
  { key: "reviewRoundsAtPr", label: "AI review rounds per PR", hint: "Target: 1.5 or fewer", format: num, good: (v) => v <= 1.5 },
  { key: "escalationRate", label: "Escalated to a person", hint: "Healthy: 10–20%", format: pct, good: (v) => v <= 0.2 },
  { key: "humanRejectionAfterAiApproval", label: "Sent back after an AI approval", hint: "Target: below 10%", format: pct, good: (v) => v < 0.1 },
  { key: "revertsPerTask", label: "Runner reverts per task", hint: "Should drop over time", format: num },
];

/** The flow's success metrics (docs/policy.md), computed from the activity log. */
export function MetricsPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["metrics"], queryFn: () => api.getMetrics(), refetchInterval: 30_000 });

  return (
    <section className="card mb-6 p-4" aria-label="Flow metrics">
      <div className="mb-3 flex items-center gap-2">
        <MetricsIcon aria-hidden className="h-4 w-4 text-text-muted" />
        <h2 className="eyebrow">How the flow is doing</h2>
        {data && (
          <span className="ml-auto text-xs text-text-muted">
            {data.tasks} tasks · {data.reachedPr} reached a PR · {data.completed} complete
            {data.leadTimeHours !== null && ` · ${num(data.leadTimeHours)} h lead time`}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {METRICS.map((m) => {
          const value = data?.[m.key];
          const tone: Tone = typeof value !== "number" || !m.good || data!.tasks === 0 ? "neutral" : m.good(value) ? "success" : "warning";
          return (
            <div key={m.key} className="rounded-lg border border-border-light px-3 py-2">
              <dt className="text-xs text-text-secondary">{m.label}</dt>
              <dd className={cn("mt-1 text-xl font-semibold tabular-nums", TONE_TEXT[tone])}>
                {isLoading ? <Skeleton className="h-6 w-12" /> : typeof value === "number" ? m.format(value) : "—"}
              </dd>
              <dd className="text-[11px] text-text-muted">{m.hint}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
