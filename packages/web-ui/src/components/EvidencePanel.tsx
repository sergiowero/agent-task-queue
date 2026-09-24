import type { AcceptanceCriterion, Evidence, Task } from "../lib/api";
import type { Tone } from "../lib/status";
import { CheckIcon, CloseIcon, PendingIcon, PlanIcon, VerifyIcon } from "../lib/icons";
import { formatRelative } from "../lib/format";
import { cn } from "../lib/cn";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { MarkdownRenderer } from "./MarkdownRenderer";

const CRITERION_TONE: Record<AcceptanceCriterion["status"], Tone> = {
  pending: "neutral",
  met: "success",
  failed: "danger",
  waived: "neutral",
};

/** Acceptance criteria with their id, status, how each is verified and the evidence behind it. */
export function CriteriaList({ criteria, evidence }: { criteria: AcceptanceCriterion[]; evidence: Evidence[] }) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return (
    <ul className="space-y-2">
      {criteria.map((c) => {
        const Icon = c.status === "met" ? CheckIcon : c.status === "failed" ? CloseIcon : PendingIcon;
        const proofs = c.evidenceIds.map((id) => byId.get(id)).filter((e): e is Evidence => !!e);
        return (
          <li key={c.id} className="flex items-start gap-2.5 text-sm text-text-secondary">
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                c.status === "met" ? "text-success" : c.status === "failed" ? "text-danger" : "text-text-muted",
              )}
              strokeWidth={2.5}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-text-muted">{c.id}</span>
                <span className="leading-snug">{c.text}</span>
                <Badge tone={CRITERION_TONE[c.status]}>{c.status}</Badge>
              </div>
              {c.verify.command ? (
                <code className="mt-0.5 block truncate font-mono text-xs text-text-muted">$ {c.verify.command}</code>
              ) : (
                <span className="text-xs text-text-muted">checked by {c.verify.kind}</span>
              )}
              {proofs.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {proofs.map((e) => (
                    <Badge key={e.id} tone={e.skipped ? "neutral" : e.exitCode === 0 ? "success" : "danger"}>
                      {e.id} {e.skipped ? "skipped" : e.exitCode === 0 ? "pass" : "fail"}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The latest verification: result, tampering, diff size, risk changes and each command's output. */
export function VerificationCard({ task, evidence }: { task: Task; evidence: Evidence[] }) {
  const v = task.verification!;
  const latest = evidence.filter((e) => e.round === v.round && e.producedBy === "runner:verify");
  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <VerifyIcon aria-hidden className="h-4 w-4 text-text-muted" />
        <h2 className="eyebrow">Verification</h2>
        <Badge tone={v.skipped ? "neutral" : v.passed ? "success" : "danger"}>
          {v.skipped ? "not run" : v.passed ? "passed" : "failed"}
        </Badge>
        {task.verifyFailures > 0 && <Badge tone="warning">{task.verifyFailures} failed in a row</Badge>}
        {task.diffStats && (
          <span className="font-mono text-xs text-text-muted">
            {task.diffStats.files} files +{task.diffStats.insertions} −{task.diffStats.deletions}
          </span>
        )}
        <span className="ml-auto text-xs text-text-muted">{formatRelative(v.at)}</span>
      </div>
      {v.note && <p className="mt-2 text-sm text-text-secondary">{v.note}</p>}
      {v.tampering.length > 0 && (
        <Alert tone="danger" title="Tests were weakened" className="mt-3">
          <ul className="list-disc pl-4">
            {v.tampering.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Alert>
      )}
      {task.riskReasons.length > 0 && (
        <Alert tone="warning" title="Risk raised to high" className="mt-3">
          <ul className="list-disc pl-4">
            {task.riskReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alert>
      )}
      {latest.length > 0 && (
        <ul className="mt-3 space-y-2">
          {latest.map((e) => (
            <li key={e.id} className="rounded-lg border border-border-light px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <Badge tone={e.skipped ? "neutral" : e.exitCode === 0 ? "success" : "danger"}>
                  {e.skipped ? "skipped" : `exit ${e.exitCode}`}
                </Badge>
                {e.flaky && <Badge tone="warning">flaky</Badge>}
                {e.criterionId && <span className="font-mono text-xs text-text-muted">{e.criterionId}</span>}
                <code className="truncate font-mono text-xs">{e.command}</code>
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-text-muted">Output</summary>
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-xs text-text-secondary">
                  {e.summary}
                </pre>
                {e.logPath && <p className="mt-1 truncate font-mono text-[11px] text-text-muted">{e.logPath}</p>}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The plan as it was approved, with its validation plan per criterion. */
export function ApprovedPlanCard({
  plan,
  criteria,
}: {
  plan: NonNullable<Task["approvedPlan"]>;
  criteria: AcceptanceCriterion[];
}) {
  const text = new Map(criteria.map((c) => [c.id, c.text]));
  return (
    <details className="card mb-4 p-4">
      <summary className="flex cursor-pointer items-center gap-2">
        <PlanIcon aria-hidden className="h-4 w-4 text-text-muted" />
        <span className="eyebrow">Approved plan</span>
        <span className="text-xs text-text-muted">
          by <span className="font-mono">{plan.approvedBy}</span>, {formatRelative(plan.at)}
        </span>
      </summary>
      {plan.validation && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-text-muted">
              <tr>
                <th className="py-1 pr-3">Criterion</th>
                <th className="py-1 pr-3">How</th>
                <th className="py-1">Command</th>
              </tr>
            </thead>
            <tbody>
              {plan.validation.items.map((item) => (
                <tr key={item.criterionId} className="border-t border-border-light align-top">
                  <td className="py-1 pr-3">
                    <span className="font-mono text-xs text-text-muted">{item.criterionId}</span>{" "}
                    {text.get(item.criterionId)}
                  </td>
                  <td className="py-1 pr-3 text-text-secondary">{item.how}</td>
                  <td className="py-1 font-mono text-xs">{item.command ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.validation.regressionCommands.length > 0 && (
            <p className="mt-2 text-xs text-text-muted">
              Must keep passing:{" "}
              {plan.validation.regressionCommands.map((c) => (
                <code key={c} className="mr-2 font-mono">
                  {c}
                </code>
              ))}
            </p>
          )}
        </div>
      )}
      <div className="mt-3">
        <MarkdownRenderer content={plan.markdown} />
      </div>
    </details>
  );
}
