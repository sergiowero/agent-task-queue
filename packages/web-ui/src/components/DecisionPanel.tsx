import type { Evidence, Finding, Task } from "../lib/api";
import { Badge } from "./Badge";
import { Checkbox } from "./Checkbox";

interface DecisionPanelProps {
  task: Task;
  findings: Finding[];
  evidence: Evidence[];
  /** Findings the person wants reopened when they request changes. */
  selected: string[];
  onToggle: (id: string) => void;
}

const VERDICT = {
  approve: { tone: "success", label: "AI approved" },
  request_changes: { tone: "warning", label: "AI asked for changes" },
  needs_human: { tone: "danger", label: "AI asked a person" },
} as const;

/**
 * Everything a person needs to decide on the code in one place: the AI verdict,
 * the verification, the diff size, the risk, the criteria and the findings —
 * answered findings can be picked to reopen with a change request.
 */
export function DecisionPanel({ task, findings, evidence, selected, onToggle }: DecisionPanelProps) {
  const codeFindings = findings.filter((f) => f.phase === "code");
  const criteria = task.acceptanceCriteria ?? [];
  const met = criteria.filter((c) => c.status === "met" || c.status === "waived").length;
  const v = task.verification;
  const failing = v ? evidence.filter((e) => e.round === v.round && !e.skipped && e.exitCode !== null && e.exitCode !== 0) : [];

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border-light p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {task.lastReview ? (
          <Badge tone={VERDICT[task.lastReview.verdict].tone}>
            {VERDICT[task.lastReview.verdict].label} (round {task.lastReview.round})
          </Badge>
        ) : (
          <Badge tone="neutral">No AI review</Badge>
        )}
        {v ? (
          <Badge tone={v.skipped ? "neutral" : v.passed ? "success" : "danger"} title={v.note ?? undefined}>
            {v.skipped ? "not verified" : v.passed ? "verification green" : `verification red (${failing.length})`}
          </Badge>
        ) : (
          <Badge tone="neutral">not verified</Badge>
        )}
        {task.diffStats && (
          <Badge tone="neutral">
            {task.diffStats.files} files, +{task.diffStats.insertions} −{task.diffStats.deletions}
          </Badge>
        )}
        <Badge tone={task.risk === "high" ? "danger" : task.risk === "medium" ? "warning" : "success"}>
          {task.risk} risk
        </Badge>
        {criteria.length > 0 && (
          <Badge tone={met === criteria.length ? "success" : "warning"}>
            {met}/{criteria.length} criteria met
          </Badge>
        )}
      </div>
      {task.riskReasons?.length > 0 && (
        <p className="text-xs text-text-muted">Risk: {task.riskReasons.join("; ")}</p>
      )}
      {codeFindings.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-text-secondary">
            Findings — tick an answered one to reopen it with your change request.
          </p>
          <ul className="space-y-1">
            {codeFindings.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  label={`Reopen ${f.id}`}
                  checked={f.status === "open" || selected.includes(f.id)}
                  disabled={f.status === "open"}
                  onChange={() => onToggle(f.id)}
                  className="mt-0.5"
                />
                <span className="font-mono text-xs text-text-muted">{f.id}</span>
                <span className="min-w-0 flex-1 truncate text-text-secondary" title={f.text}>
                  {f.text}
                </span>
                <Badge tone={f.status === "open" ? "danger" : f.status === "verified" ? "success" : "info"}>
                  {f.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
