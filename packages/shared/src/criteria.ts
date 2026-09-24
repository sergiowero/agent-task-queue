/**
 * Acceptance criteria as objects: an id, how each one is verified, its status
 * and the evidence behind it. Pure module (the web UI imports it).
 */
import type { CriterionStatus, VerifyKind } from "./catalog.js";

export interface AcceptanceCriterion {
  /** "AC1", "AC2", ... stable for the life of the task. */
  id: string;
  text: string;
  verify: { kind: VerifyKind; command?: string; notes?: string };
  status: CriterionStatus;
  evidenceIds: string[];
}

/** What callers may pass: a plain string, or a partial criterion. */
export type CriterionInput =
  | string
  | {
      id?: string;
      text: string;
      verify?: { kind: VerifyKind; command?: string; notes?: string };
      status?: CriterionStatus;
    };

/**
 * `text $ command` in a one-line editor means "verified by running command".
 * Returns the text and the command (if any).
 */
export function parseCriterionLine(line: string): { text: string; command?: string } {
  const at = line.lastIndexOf(" $ ");
  if (at === -1) return { text: line.trim() };
  const command = line.slice(at + 3).trim();
  return command ? { text: line.slice(0, at).trim(), command } : { text: line.trim() };
}

export function formatCriterionLine(c: Pick<AcceptanceCriterion, "text" | "verify">): string {
  return c.verify.command && (c.verify.kind === "command" || c.verify.kind === "test")
    ? `${c.text} $ ${c.verify.command}`
    : c.text;
}

/**
 * Turns inputs into criteria with ids. Criteria that keep their id (or their
 * exact text) keep their status and evidence; new ones get the next free id.
 */
export function normalizeCriteria(
  inputs: CriterionInput[],
  existing: AcceptanceCriterion[] = [],
): AcceptanceCriterion[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const byText = new Map(existing.map((c) => [c.text, c]));
  let next = Math.max(0, ...existing.map((c) => Number(c.id.replace(/^AC/, "")) || 0)) + 1;
  const used = new Set<string>();
  const out: AcceptanceCriterion[] = [];
  for (const input of inputs) {
    const raw = typeof input === "string" ? parseCriterionLine(input) : input;
    const text = raw.text.trim();
    if (!text) continue;
    const verify =
      typeof input !== "string" && input.verify
        ? input.verify
        : "command" in raw && raw.command
          ? { kind: "command" as const, command: raw.command }
          : undefined;
    const previous =
      (typeof input !== "string" && input.id ? byId.get(input.id) : undefined) ?? byText.get(text);
    let id = previous && !used.has(previous.id) ? previous.id : undefined;
    if (!id) {
      while (used.has(`AC${next}`) || byId.has(`AC${next}`)) next++;
      id = `AC${next++}`;
    }
    used.add(id);
    const sameCheck = previous && previous.text === text && !verify;
    out.push({
      id,
      text,
      verify: verify ?? (sameCheck ? previous!.verify : undefined) ?? { kind: "review" },
      status: (typeof input !== "string" && input.status) || (previous && previous.text === text ? previous.status : "pending"),
      evidenceIds: previous && previous.text === text ? previous.evidenceIds : [],
    });
  }
  return out;
}

/** Old rows stored criteria as plain strings. */
export function criteriaFromStored(raw: unknown): AcceptanceCriterion[] {
  if (!Array.isArray(raw)) return [];
  if (raw.every((c) => typeof c === "object" && c && "id" in c)) return raw as AcceptanceCriterion[];
  return normalizeCriteria(raw.filter((c) => typeof c === "string" || (c && typeof c === "object")) as CriterionInput[]);
}
