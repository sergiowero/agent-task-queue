import type { Evidence, Finding, Task } from "../lib/api";
import type { RoundChip } from "@agentq/shared/policy";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { FindingChecklist } from "./FindingChecklist";
import { verificationEvidence } from "./EvidencePanel";

interface DecisionPanelProps {
  task: Task;
  findings: Finding[];
  evidence: Evidence[];
  /** Findings the person wants reopened when they request changes. */
  selected: string[];
  onToggle: (id: string) => void;
  /** AI reviews used against the project's limit ("R2/3"). */
  rounds?: RoundChip | null;
  /**
   * Answering an escalated review or verification (a blocked task) instead of
   * reviewing code: open findings can be accepted, and reopening applies only
   * while the answer sends the task back to the coder.
   */
  blocked?: {
    accepted: string[];
    onToggleAccept: (id: string) => void;
    canReopen: boolean;
  };
}

const VERDICT = {
  approve: { tone: "success", label: "AI approved" },
  request_changes: { tone: "warning", label: "AI asked for changes" },
  needs_human: { tone: "danger", label: "AI asked a person" },
} as const;

/**
 * Everything a person needs to decide on the code in one place: the AI verdict,
 * the verification, the diff size, the risk, the criteria and the findings —
 * answered findings can be picked to reopen with a change request. The same
 * panel decides an escalated review or verification (`blocked`).
 */
export function DecisionPanel({ task, findings, evidence, selected, onToggle, rounds, blocked }: DecisionPanelProps) {
  const codeFindings = findings.filter((f) => f.phase === "code");
  const criteria = task.acceptanceCriteria ?? [];
  const met = criteria.filter((c) => c.status === "met" || c.status === "waived").length;
  const v = task.verification;
  const failing = verificationEvidence(task, evidence).filter((e) => !e.skipped && e.exitCode !== null && e.exitCode !== 0);
  // A needs_human blocker already shows the reviewer's question; under L0 nothing else does.
  const question = !task.blocker ? task.lastReview?.question : undefined;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border-light p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {task.lastReview ? (
          <Badge
            tone={task.lastReview.stale ? "neutral" : VERDICT[task.lastReview.verdict].tone}
            title={task.lastReview.stale ? "Not AI-reviewed since the last change" : undefined}
          >
            {VERDICT[task.lastReview.verdict].label} (round {task.lastReview.round}
            {task.lastReview.stale ? ", before the last change" : ""})
          </Badge>
        ) : (
          <Badge tone="neutral">No AI review</Badge>
        )}
        {rounds && (
          <Badge
            tone={rounds.atLimit ? "danger" : rounds.nearLimit ? "warning" : "neutral"}
            title="AI reviews that asked for changes, against the project's limit (counted from your last answer)"
          >
            {rounds.label}
          </Badge>
        )}
        {v ? (
          <Badge tone={v.skipped ? "neutral" : v.passed ? "success" : "danger"} title={v.note ?? undefined}>
            {v.skipped ? "not verified" : v.passed ? "verification green" : `verification red (${failing.length})`}
          </Badge>
        ) : (
          <Badge tone="neutral">not verified</Badge>
        )}
        {task.verifyFailures > 0 && <Badge tone="warning">{task.verifyFailures} red in a row</Badge>}
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
      {question && (
        <Alert tone="warning" title="The AI reviewer asks">
          {question}
        </Alert>
      )}
      {blocked && v && v.tampering.length > 0 && (
        <Alert tone="danger" title="Tests were weakened">
          <ul className="list-disc pl-4">
            {v.tampering.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Alert>
      )}
      {task.riskReasons?.length > 0 && (
        <p className="text-xs text-text-muted">Risk: {task.riskReasons.join("; ")}</p>
      )}
      {codeFindings.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-text-secondary">
            {blocked
              ? "Findings: open ones go back with the task unless you accept them; tick an answered one to reopen it with your answer."
              : "Findings — tick an answered one to reopen it with your change request."}
          </p>
          <FindingChecklist
            findings={codeFindings}
            reopen={selected}
            onToggleReopen={onToggle}
            canReopen={blocked?.canReopen}
            accepted={blocked?.accepted}
            onToggleAccept={blocked?.onToggleAccept}
          />
        </div>
      )}
    </div>
  );
}
