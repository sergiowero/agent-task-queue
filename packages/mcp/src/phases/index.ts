/// <reference path="./markdown.d.ts" />
import archive from "./moonlightq-archive.md" with { type: "text" };
import claim from "./moonlightq-claim.md" with { type: "text" };
import code from "./moonlightq-code.md" with { type: "text" };
import createTask from "./moonlightq-create-task.md" with { type: "text" };
import plan from "./moonlightq-plan.md" with { type: "text" };
import planReview from "./moonlightq-plan-review.md" with { type: "text" };
import pr from "./moonlightq-pr.md" with { type: "text" };
import refine from "./moonlightq-refine.md" with { type: "text" };
import review from "./moonlightq-review.md" with { type: "text" };
import verify from "./moonlightq-verify.md" with { type: "text" };

/**
 * Version of the workflow instructions this server ships. Agents pass it as
 * `skillsVersion` on claim_task; skills installed by earlier releases carry an
 * older one and are refused, so their stale text is never followed.
 */
export const PHASES_VERSION = "8.0.0";

/**
 * Oldest `skillsVersion` claim_task accepts. 8.0.0 is the first release that serves
 * the skills only from this server; older versions come from installed copies.
 */
export const MIN_COMPATIBLE_PHASES_VERSION = "8.0.0";

/** The workflow instructions, keyed by the name agents ask for (get_skill, phaseSkill). */
const PHASES: Record<string, string> = {
  "moonlightq-archive": archive,
  "moonlightq-claim": claim,
  "moonlightq-code": code,
  "moonlightq-create-task": createTask,
  "moonlightq-plan": plan,
  "moonlightq-plan-review": planReview,
  "moonlightq-pr": pr,
  "moonlightq-refine": refine,
  "moonlightq-review": review,
  "moonlightq-verify": verify,
};

export interface PhaseDocument {
  name: string;
  version: string;
  /** The instructions, in Markdown. */
  body: string;
}

/** Every instruction document's name, sorted. */
export function listPhases(): string[] {
  return Object.keys(PHASES).sort();
}

/** One instruction document; throws for an unknown name. */
export function readPhase(name: string): PhaseDocument {
  const body = PHASES[name];
  if (body === undefined) throw new Error(`Unknown skill ${name}. Skills: ${listPhases().join(", ")}.`);
  return { name, version: PHASES_VERSION, body };
}
