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

/** Whether the one-line format shows a criterion's check (see formatCriterionLine). */
function shownInLine(verify: AcceptanceCriterion["verify"]): boolean {
  return !!verify.command && (verify.kind === "command" || verify.kind === "test");
}

/**
 * Turns inputs into criteria with ids. Criteria that keep their id (or their
 * exact text) keep their status and evidence; new ones get the next free id.
 * With as many inputs as criteria, one reworded in place keeps the id of the
 * criterion at its position, so the validation plan and the evidence still
 * point at it; its status and evidence start over. A line without " $ command" drops
 * the command it had; a check the line cannot show (manual, review) is kept.
 */
export function normalizeCriteria(
  inputs: CriterionInput[],
  existing: AcceptanceCriterion[] = [],
): AcceptanceCriterion[] {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const byText = new Map(existing.map((c) => [c.text, c]));
  let next = Math.max(0, ...existing.map((c) => Number(c.id.replace(/^AC/, "")) || 0)) + 1;
  const parsed = inputs
    .map((input) => {
      const raw = typeof input === "string" ? parseCriterionLine(input) : input;
      const verify =
        typeof input !== "string" && input.verify
          ? input.verify
          : "command" in raw && raw.command
            ? { kind: "command" as const, command: raw.command }
            : undefined;
      return {
        text: raw.text.trim(),
        id: typeof input !== "string" ? input.id : undefined,
        status: typeof input !== "string" ? input.status : undefined,
        verify,
      };
    })
    .filter((p) => p.text);

  // By id, then by exact text; then a reworded one takes the criterion at its place, if still free.
  const used = new Set<string>();
  const previous = parsed.map((p) => {
    const match = (p.id ? byId.get(p.id) : undefined) ?? byText.get(p.text);
    if (!match || used.has(match.id)) return undefined;
    used.add(match.id);
    return match;
  });
  if (parsed.length === existing.length) {
    previous.forEach((match, i) => {
      if (match || used.has(existing[i].id)) return;
      previous[i] = existing[i];
      used.add(existing[i].id);
    });
  }

  return parsed.map((p, i) => {
    const prev = previous[i];
    let id = prev?.id;
    if (!id) {
      while (used.has(`AC${next}`) || byId.has(`AC${next}`)) next++;
      id = `AC${next++}`;
      used.add(id);
    }
    const same = !!prev && prev.text === p.text;
    let verify: AcceptanceCriterion["verify"];
    if (p.verify) {
      // The same command keeps its kind (test) and notes through the one-line editor.
      verify = prev && shownInLine(prev.verify) && prev.verify.command === p.verify.command && p.verify.kind === "command" ? prev.verify : p.verify;
    } else if (prev && (p.id || !shownInLine(prev.verify))) {
      verify = prev.verify;
    } else {
      verify = { kind: "review" };
    }
    return {
      id,
      text: p.text,
      verify,
      status: p.status || (same ? prev!.status : "pending"),
      evidenceIds: same ? prev!.evidenceIds : [],
    };
  });
}

/** Old rows stored criteria as plain strings. */
export function criteriaFromStored(raw: unknown): AcceptanceCriterion[] {
  if (!Array.isArray(raw)) return [];
  if (raw.every((c) => typeof c === "object" && c && "id" in c)) return raw as AcceptanceCriterion[];
  return normalizeCriteria(raw.filter((c) => typeof c === "string" || (c && typeof c === "object")) as CriterionInput[]);
}
