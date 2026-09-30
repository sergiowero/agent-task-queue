import type { Finding, ProjectProfile, Task } from "../lib/api";
import type { RoundChip } from "@agentq/shared/policy";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { FindingChecklist } from "./FindingChecklist";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ValidationTable } from "./EvidencePanel";

interface PlanDecisionPanelProps {
  task: Task;
  findings: Finding[];
  /** The project's profile (defaults filled in): what the verifier may run without a person's approval. */
  profile: ProjectProfile;
  /** Plan findings the person wants the planner to answer again. */
  selected: string[];
  onToggle: (id: string) => void;
  /** Plan critiques used against the project's limit ("P1/2"). */
  rounds?: RoundChip | null;
  /** Answering a blocked plan instead of approving it (see DecisionPanel). */
  blocked?: {
    accepted: string[];
    onToggleAccept: (id: string) => void;
    canReopen: boolean;
  };
}

/** The latest submitted plan, and the AI critic's review of that very plan (if it came after it). */
export function latestPlan(task: Task) {
  const entries = task.conversation ?? [];
  const at = entries.map((e) => e.messageType).lastIndexOf("plan");
  if (at < 0) return { plan: null, critique: null };
  const critique = [...entries.slice(at + 1)].reverse().find((e) => e.messageType === "plan_review") ?? null;
  return { plan: entries[at], critique };
}

/**
 * Everything a person needs to decide on a plan next to the buttons: the plan,
 * the AI critic's review of it, the commands an approval lets the verifier run
 * (flagging the ones off the allowlist or chaining commands), the risk and the
 * plan findings, which can be picked to be answered again.
 */
export function PlanDecisionPanel({ task, findings, profile, selected, onToggle, rounds, blocked }: PlanDecisionPanelProps) {
  const { plan, critique } = latestPlan(task);
  const planFindings = findings.filter((f) => f.phase === "plan");
  const criteria = task.acceptanceCriteria ?? [];
  const approved = task.status === "waiting_plan_review";

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border-light p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {critique ? (
          <Badge tone={approved ? "success" : "warning"} title={`Critique by ${critique.authorName}`}>
            {approved ? "AI critic approved" : "AI critic reviewed"}
            {task.planRound > 0 ? ` (round ${task.planRound})` : ""}
          </Badge>
        ) : (
          <Badge tone="neutral" title="No AI critic has reviewed this plan: it is yours to judge">
            No AI critique
          </Badge>
        )}
        {rounds && (
          <Badge
            tone={rounds.atLimit ? "danger" : rounds.nearLimit ? "warning" : "neutral"}
            title="Plan critiques that asked for changes, against the project's limit (counted from your last answer)"
          >
            {rounds.label}
          </Badge>
        )}
        <Badge tone={task.risk === "high" ? "danger" : task.risk === "medium" ? "warning" : "success"}>
          {task.risk} risk
        </Badge>
        {task.planSubmission?.sizeWarnings && task.planSubmission.sizeWarnings.length > 0 && (
          <Badge tone="warning" title={task.planSubmission.sizeWarnings.join("\n")}>
            bigger than the size limits
          </Badge>
        )}
      </div>
      {task.riskReasons?.length > 0 && <p className="text-xs text-text-muted">Risk: {task.riskReasons.join("; ")}</p>}
      {plan ? (
        <details open>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-text-muted">The plan</summary>
          <div className="mt-2 max-h-96 overflow-auto rounded-lg bg-surface-secondary/50 p-3">
            <MarkdownRenderer content={plan.message} />
          </div>
        </details>
      ) : (
        <p className="text-sm text-text-muted">There is no submitted plan text.</p>
      )}
      {critique && (
        <details>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-text-muted">
            The critic's review
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-secondary/50 p-3">
            <MarkdownRenderer content={critique.message} />
          </div>
        </details>
      )}
      <div>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
          Commands your approval allows the verifier to run
        </h3>
        {task.validationPlan ? (
          <ValidationTable validation={task.validationPlan} criteria={criteria} profile={profile} />
        ) : (
          <Alert tone="info" title="No validation plan submitted">
            The verifier runs only the project's commands
            {criteria.some((c) => c.verify.command) ? " and the commands in the acceptance criteria" : ""}.
          </Alert>
        )}
      </div>
      {planFindings.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-text-secondary">
            {blocked
              ? "Plan findings: open ones go back with the task unless you accept them; tick an answered one to have the planner answer it again."
              : "Plan findings — tick one to have the planner answer it again with your change request."}
          </p>
          <FindingChecklist
            findings={planFindings}
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
