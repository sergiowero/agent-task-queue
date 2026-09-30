/**
 * Which checks the runners can take under separation of duties: nobody checks
 * their own work and, under requireDifferentModel, nobody on the author's model.
 * Pure functions over plain data, so the portal can warn before a check starves.
 */
import { modelKey, type Role } from "./catalog.js";
import { resolvePolicy, type PolicyProject } from "./policy.js";

/** A runner as the check sees it. */
export interface SeparationRunner {
  id: string;
  tool: string;
  model: string | null;
  roles: readonly Role[];
  /** null: the runner works every project. */
  projectId: string | null;
  enabled: boolean;
}

export interface SeparationProject extends PolicyProject {
  id: string;
}

/** A check no runner may take for some runners' work in a project. */
export interface SeparationGap {
  projectId: string;
  /** The checking role: plan_review (plan critique) or review (code review). */
  check: "plan_review" | "review";
  /**
   * separation: no other runner has the role;
   * model: every other runner with the role is on the author's model, and the project requires a different one.
   */
  reason: "separation" | "model";
  /** Runners whose work nobody may check. */
  authors: string[];
}

/**
 * The checks the project's gates hand to agents, with the role whose work they
 * check. Verification is left out: the built-in verifier, which is what makes
 * code wait for verification, always may take it.
 */
const CHECKS = [
  { check: "plan_review", author: "plan", gate: "plan" },
  { check: "review", author: "code", gate: "code" },
] as const;

/**
 * Checks no enabled runner may take, per project. Such a check waits for a
 * hand-opened agent session and goes to a person after `reviewStarvationMin`.
 */
export function separationGaps(
  runners: readonly SeparationRunner[],
  projects: readonly SeparationProject[],
): SeparationGap[] {
  const gaps: SeparationGap[] = [];
  for (const project of projects) {
    const policy = resolvePolicy(project);
    const here = runners.filter(
      (r) => r.enabled && (r.projectId === null || r.projectId === project.id),
    );
    for (const { check, author, gate } of CHECKS) {
      if (policy[gate] !== "agent") continue;
      const checkers = here.filter((r) => r.roles.includes(check));
      const bySeparation: string[] = [];
      const byModel: string[] = [];
      for (const a of here.filter((r) => r.roles.includes(author))) {
        const others = checkers.filter((c) => c.id !== a.id);
        const key = modelKey(a.tool, a.model);
        if (others.length === 0) bySeparation.push(a.id);
        else if (
          policy.requireDifferentModel &&
          others.every((c) => modelKey(c.tool, c.model) === key)
        ) {
          byModel.push(a.id);
        }
      }
      if (bySeparation.length)
        gaps.push({ projectId: project.id, check, reason: "separation", authors: bySeparation });
      if (byModel.length)
        gaps.push({ projectId: project.id, check, reason: "model", authors: byModel });
    }
  }
  return gaps;
}
