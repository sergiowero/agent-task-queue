/**
 * Per-task records that several actors append to and that each carry their own
 * status (review findings). They live in their own tables; every write bumps
 * the task's updated_at so the web server's watcher broadcasts the change.
 */
import { getDbHandle, touchTask } from "./database.js";
import type { FindingStatus, Severity } from "./catalog.js";
import type { Evidence, Finding } from "./types.js";

function rowToFinding(row: any): Finding {
  return {
    id: row.id,
    taskId: row.task_id,
    round: row.round,
    phase: row.phase,
    severity: row.severity,
    file: row.file ?? null,
    line: row.line ?? null,
    text: row.text,
    status: row.status,
    resolution: row.resolution ?? null,
    raisedBy: row.raised_by,
    reopenCount: row.reopen_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewFinding {
  severity: Severity;
  text: string;
  file?: string | null;
  line?: number | null;
}

/** Finding id prefix per source: R = code review, P = plan review, H = a person. */
export type FindingSource = "R" | "P" | "H";

/** Adds findings for a round; ids are `${source}${round}-${n}`. Returns them. */
export function addFindings(
  taskId: string,
  source: FindingSource,
  round: number,
  findings: NewFinding[],
  raisedBy: string,
): Finding[] {
  if (findings.length === 0) return [];
  const d = getDbHandle();
  const phase = source === "P" ? "plan" : "code";
  const prefix = `${source}${round}-`;
  const last = d
    .prepare("SELECT MAX(seq) AS seq FROM task_findings WHERE task_id = ? AND id LIKE ?")
    .get(taskId, `${prefix}%`) as { seq: number | null };
  let seq = last?.seq ?? 0;
  const now = new Date().toISOString();
  const insert = d.prepare(
    `INSERT INTO task_findings (task_id, id, round, phase, seq, severity, file, line, text, status, raised_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
  );
  const ids: string[] = [];
  for (const f of findings) {
    seq += 1;
    const id = `${prefix}${seq}`;
    insert.run(taskId, id, round, phase, seq, f.severity, f.file ?? null, f.line ?? null, f.text.trim(), raisedBy, now, now);
    ids.push(id);
  }
  touchTask(taskId);
  return ids.map((id) => getFinding(taskId, id)!);
}

export function getFinding(taskId: string, id: string): Finding | null {
  const row = getDbHandle().prepare("SELECT * FROM task_findings WHERE task_id = ? AND id = ?").get(taskId, id);
  return row ? rowToFinding(row) : null;
}

export function getFindings(taskId: string, filter: { phase?: "plan" | "code"; status?: FindingStatus[] } = {}): Finding[] {
  let sql = "SELECT * FROM task_findings WHERE task_id = ?";
  const params: any[] = [taskId];
  if (filter.phase) {
    sql += " AND phase = ?";
    params.push(filter.phase);
  }
  if (filter.status?.length) {
    sql += ` AND status IN (${filter.status.map(() => "?").join(", ")})`;
    params.push(...filter.status);
  }
  sql += " ORDER BY round ASC, seq ASC";
  return getDbHandle().prepare(sql).all(...params).map(rowToFinding);
}

/** Findings a reviewer still has to see fixed: open ones, plus fixed/wontfix ones not yet verified. */
export function getOpenFindings(taskId: string, phase?: "plan" | "code"): Finding[] {
  return getFindings(taskId, { phase, status: ["open"] });
}

export function updateFinding(
  taskId: string,
  id: string,
  patch: { status?: FindingStatus; resolution?: string | null; reopened?: boolean },
): Finding | null {
  const existing = getFinding(taskId, id);
  if (!existing) return null;
  getDbHandle()
    .prepare(
      "UPDATE task_findings SET status = ?, resolution = ?, reopen_count = reopen_count + ?, updated_at = ? WHERE task_id = ? AND id = ?",
    )
    .run(
      patch.status ?? existing.status,
      patch.resolution !== undefined ? patch.resolution : existing.resolution,
      patch.reopened ? 1 : 0,
      new Date().toISOString(),
      taskId,
      id,
    );
  touchTask(taskId);
  return getFinding(taskId, id);
}

// ─── Evidence ─────────────────────────────────────────────────────────

function rowToEvidence(row: any): Evidence {
  return {
    id: row.id,
    taskId: row.task_id,
    round: row.round,
    kind: row.kind,
    criterionId: row.criterion_id ?? null,
    command: row.command ?? null,
    exitCode: row.exit_code ?? null,
    summary: row.summary,
    logPath: row.log_path ?? null,
    producedBy: row.produced_by,
    flaky: row.flaky === 1,
    skipped: row.skipped === 1,
    createdAt: row.created_at,
  };
}

export interface NewEvidence {
  kind: "command" | "manual";
  criterionId?: string | null;
  command?: string | null;
  exitCode?: number | null;
  summary: string;
  logPath?: string | null;
  flaky?: boolean;
  skipped?: boolean;
}

/** Adds evidence for a round; ids are E1, E2, ... per task. */
export function addEvidence(taskId: string, round: number, items: NewEvidence[], producedBy: string): Evidence[] {
  if (items.length === 0) return [];
  const d = getDbHandle();
  const last = d.prepare("SELECT MAX(seq) AS seq FROM task_evidence WHERE task_id = ?").get(taskId) as { seq: number | null };
  let seq = last?.seq ?? 0;
  const now = new Date().toISOString();
  const insert = d.prepare(
    `INSERT INTO task_evidence (task_id, id, seq, round, kind, criterion_id, command, exit_code, summary, log_path, produced_by, flaky, skipped, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ids: string[] = [];
  for (const e of items) {
    seq += 1;
    const id = `E${seq}`;
    insert.run(
      taskId, id, seq, round, e.kind, e.criterionId ?? null, e.command ?? null, e.exitCode ?? null,
      e.summary.trim().slice(0, 8000), e.logPath ?? null, producedBy, e.flaky ? 1 : 0, e.skipped ? 1 : 0, now,
    );
    ids.push(id);
  }
  touchTask(taskId);
  const all = getEvidence(taskId);
  return all.filter((e) => ids.includes(e.id));
}

export function getEvidence(taskId: string): Evidence[] {
  return getDbHandle()
    .prepare("SELECT * FROM task_evidence WHERE task_id = ? ORDER BY seq ASC")
    .all(taskId)
    .map(rowToEvidence);
}
