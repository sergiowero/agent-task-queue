/**
 * Definition of Ready: what a task needs before an agent can start it without
 * asking. Pure checks over the creation input; the project's dorMode decides
 * whether problems only warn or block creation.
 */
import type { Risk, TaskType } from "./catalog.js";
import type { CriterionInput } from "./criteria.js";

export interface ReadinessInput {
  description?: string | null;
  acceptanceCriteria?: CriterionInput[];
  type?: TaskType;
  risk?: Risk;
  requiresPlan?: boolean;
}

export function checkDefinitionOfReady(input: ReadinessInput): string[] {
  const issues: string[] = [];
  const description = input.description?.trim() ?? "";
  const criteria = input.acceptanceCriteria ?? [];
  if (description.length < 30) issues.push("The description is very short: say what should change and why.");
  if (criteria.length === 0) issues.push("No acceptance criteria: say how anyone will know the task is done.");
  const checkable = criteria.some((c) =>
    typeof c === "string"
      ? c.includes(" $ ")
      : c.verify && c.verify.kind !== "review" && (c.verify.kind === "manual" || !!c.verify.command),
  );
  if (criteria.length > 0 && !checkable) {
    issues.push("No criterion says how it is verified: add a command (\"text $ command\") or a test for at least one.");
  }
  if (input.risk === "high" && !input.requiresPlan) {
    issues.push("High-risk tasks should require a plan, so a person approves the approach first.");
  }
  if (input.type === "bug" && !/(reproduce|steps|expected|actual)/i.test(description)) {
    issues.push("Bug without reproduction steps or expected vs. actual behaviour.");
  }
  return issues;
}
