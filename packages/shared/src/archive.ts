import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import {
  getActivityEvents,
  getAgentById,
  getProjectById,
  getSubtasks,
  getTaskById,
  setTaskArchive,
  slugify,
} from "./database.js";
import { AUTONOMY_LEVELS, HUMAN_ACTOR } from "./catalog.js";
import { resolvePolicy } from "./policy.js";
import { getEvidence, getFindings, getHandoffs } from "./records.js";
import { resolveProfile } from "./profile.js";
import type {
  AcceptanceCriterion,
  ActivityEvent,
  Agent,
  Approval,
  ApprovedPlan,
  ConversationEntry,
  Evidence,
  Finding,
  Handoff,
  LastReview,
  Project,
  PullRequest,
  StatusHistoryEntry,
  Task,
} from "./types.js";
import { TaskStatus } from "./types.js";
import { WorkflowError, addActivity, addConversation } from "./workflow.js";

/** Folder, inside the project's working directory, that holds archived tasks. */
export const ARCHIVE_DIR_NAME = "archive";

/** Only finished work is archived: the board shows "Archive" on complete cards. */
export const ARCHIVABLE_STATUSES = new Set<TaskStatus>([TaskStatus.Complete]);

/** A runner job that worked on the task (only the web server knows these). */
export interface ArchiveRunnerJob {
  runnerName: string;
  tool: string;
  phase: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  exitCode?: number | null;
  logPath: string;
}

/** One claim of the task by an agent, from the claim until the task left that status. */
export interface AgentSession {
  agentId: string;
  /**
   * Active status the claim moved the task to: refining, planning, plan_reviewing,
   * coding, verifying, reviewing or merging.
   */
  status: string;
  claimedAt: string;
  endedAt: string | null;
  /** Status the policy sent the task to when the session ended, e.g. plan_review_requested or approved. */
  endStatus: string | null;
  /** Index in task.conversation of the claim entry. */
  claimIndex: number;
  /** Index in task.conversation of the session's submission (plan, critique, code, verification, review, PR...), if any. */
  submissionIndex: number | null;
  /** What the submission is called ("Plan critique submitted", "Verification failed"...); null when the session submitted nothing. */
  submitted: string | null;
}

export interface MergeRecord {
  branch: string | null;
  commit: string | null;
  authors: string | null;
  worktree: string | null;
}

export interface ArchiveDocumentsInput {
  task: Task;
  project: Project | null;
  /** Agents table rows of the agents that claimed the task (missing ids are fine). */
  agents: Agent[];
  /** Activity events of the task, any order. */
  activity: ActivityEvent[];
  archivedAt: string;
  /** File names (not paths) of the two documents, used for the cross links. */
  summaryFile: string;
  detailedFile: string;
  pullRequests: string[];
  /** Optional overview written by an agent, placed at the top of the summary. */
  overview?: string;
  runnerJobs?: ArchiveRunnerJob[];
  /** Review findings of the task (plan and code reviews), with their answers. */
  findings?: Finding[];
  /** Evidence rows: commands the coder and the verifier ran, and manual checks. */
  evidence?: Evidence[];
  /** Notes each phase left for the next, and the answers people gave. */
  handoffs?: Handoff[];
  /** The subtasks the task was split into. */
  subtasks?: Task[];
}

export interface ArchiveDocuments {
  summary: string;
  detailed: string;
}

export interface ArchiveTaskOptions {
  /** Archive a task that was already archived again, rewriting its files. */
  force?: boolean;
  /** Pull request URLs or refs to record, in addition to the ones found in the conversation. */
  pullRequests?: string[];
  /** Overview written by an agent, placed at the top of the summary. */
  overview?: string;
  /** Runner jobs that worked on the task. */
  runnerJobs?: ArchiveRunnerJob[];
  /** Author of the "Task archived" conversation entry and activity event. Default "user". */
  actor?: string;
  /** Output folder. Defaults to {project.workingDirectory}/archive. */
  directory?: string;
}

export interface ArchiveTaskResult {
  task: Task;
  directory: string;
  summaryPath: string;
  detailedPath: string;
  pullRequests: string[];
}

/** One criterion for the archive: status mark, id, text and how it was checked (and the evidence, when asked). */
function criterionLine(c: AcceptanceCriterion, withEvidence = false): string {
  const mark = { met: "✅", failed: "❌", waived: "➖", pending: "⬜" }[c.status] ?? "⬜";
  const how = c.verify.command ? ` — \`${c.verify.command}\`` : c.verify.kind !== "review" ? ` — ${c.verify.kind}` : "";
  const proof = withEvidence && c.evidenceIds.length ? ` · evidence ${c.evidenceIds.join(", ")}` : "";
  return `${mark} **${c.id}** ${c.text}${how}${proof}`;
}

// ─── Labels ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  plan_requested: "Plan requested",
  planning: "Planning",
  waiting_plan_review: "Waiting plan review",
  plan_changes_requested: "Plan changes requested",
  ready_for_code: "Ready for code",
  coding: "Coding",
  waiting_code_review: "Waiting code review",
  code_review_requested: "AI review requested",
  reviewing: "Reviewing",
  changes_requested: "Changes requested",
  approved: "Approved",
  merging: "Merging",
  merged: "Merged",
  complete: "Complete",
  canceled: "Canceled",
  needs_human: "Needs human",
  pr_open: "PR open",
  verify_requested: "Verify requested",
  verifying: "Verifying",
  plan_review_requested: "Plan critique requested",
  plan_reviewing: "Plan critique",
  draft: "Draft",
  refining: "Refining",
  split: "Split into subtasks",
};

export function archiveStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

interface SessionPhase {
  phase: string;
  type: string;
  submitted: string;
}

/**
 * The active statuses a claim moves a task to, in flow order: the phase each one
 * works, the conversation type its submission is written with, and what that
 * submission is called. Where the task goes next is not fixed by the phase (the
 * autonomy level, the risk and the verdict route it), so a session's outcome
 * names the status it really ended in.
 */
const SESSION_PHASES: Record<string, SessionPhase> = {
  refining: { phase: "Refinement", type: "refine", submitted: "Draft refined" },
  planning: { phase: "Planning", type: "plan", submitted: "Plan submitted" },
  plan_reviewing: { phase: "Plan critique", type: "plan_review", submitted: "Plan critique submitted" },
  coding: { phase: "Coding", type: "code", submitted: "Code submitted" },
  verifying: { phase: "Verification", type: "verify", submitted: "Verification reported" },
  reviewing: { phase: "Review", type: "review", submitted: "Review submitted" },
  merging: { phase: "Merge", type: "merge", submitted: "PR opened" },
};

function phaseLabel(status: string): string {
  return SESSION_PHASES[status]?.phase ?? archiveStatusLabel(status);
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  user: "User",
  agent: "Agent note",
  refine: "Refinement",
  plan: "Plan",
  plan_review: "Plan critique",
  code: "Code submission",
  verify: "Verification",
  review: "Review",
  merge: "Merge",
  system: "System",
};

/** The phases a handoff can come from; a person's answer or a claim note is not one of the agents' phases. */
const HANDOFF_PHASE_LABELS: Record<string, string> = {
  refine: "Refinement",
  plan: "Plan",
  plan_review: "Plan critique",
  code: "Code",
  verify: "Verification",
  review: "Review",
  merge: "Merge",
  human: "Person",
  claim: "Claim note",
  legacy: "Earlier note",
};

// ─── Markdown helpers ──────────────────────────────────────────────────

/** `YYYY-MM-DD HH:MM:SS UTC`, or the input unchanged when it is not a date. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function durationBetween(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return formatDuration(new Date(to).getTime() - new Date(from).getTime());
}

function longestBacktickRun(text: string): number {
  return (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
}

/** Inline code span that survives backticks in the text. */
export function inlineCode(text: string): string {
  const ticks = "`".repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

/** Fenced code block whose fence is longer than any backtick run in the content. */
function fenced(content: string, lang = ""): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  return `${fence}${lang}\n${content.replace(/\n+$/, "")}\n${fence}`;
}

/** Escapes a value for a GFM table cell (pipes also need escaping inside code spans). */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^( {0,3})(#{1,6})(?=\s|$)/;

/**
 * Prepares a Markdown message (a plan, a review...) to sit under a heading of
 * the archive: its headings are demoted so the shallowest one lands on
 * `minLevel` (capped at h6), and a code fence left open is closed so it cannot
 * swallow the rest of the document.
 */
export function embedMarkdown(markdown: string, minLevel: number): string {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  const inCode: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const fence = line.match(FENCE_RE);
    if (open) {
      inCode.push(true);
      if (fence && fence[1][0] === open[0] && fence[1].length >= open.length && !fence[2].trim()) {
        open = null;
      }
    } else if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      inCode.push(true);
      open = fence[1];
    } else {
      inCode.push(false);
    }
  }

  let shallowest = 7;
  lines.forEach((line, i) => {
    const heading = !inCode[i] && line.match(HEADING_RE);
    if (heading) shallowest = Math.min(shallowest, heading[2].length);
  });
  const shift = shallowest <= 6 ? Math.max(0, minLevel - shallowest) : 0;

  const out = lines.map((line, i) => {
    if (inCode[i] || shift === 0) return line;
    return line.replace(
      HEADING_RE,
      (_m, indent: string, hashes: string) =>
        `${indent}${"#".repeat(Math.min(6, hashes.length + shift))}`,
    );
  });
  if (open) out.push(open);
  return out.join("\n");
}

function orNone(value: string | null | undefined, fallback = "—"): string {
  return value && value.trim() ? value : fallback;
}

function codeOrNone(value: string | null | undefined): string {
  return value && value.trim() ? inlineCode(value) : "—";
}

// ─── Facts extracted from the task ─────────────────────────────────────

export const PR_URL_RE = /https?:\/\/[^\s<>()[\]"'`]+?\/(?:pull|pulls|merge_requests|pull-requests)\/\d+/g;
const PR_REF_RE = /\b(?:PR|pull request)\b[^\n#\d]{0,12}#(\d+)/gi;

/**
 * Pull requests mentioned in the conversation (the merge skill records the
 * `gh pr create` URL there), after the explicitly given ones. Bare `PR #12`
 * references are only used when no URL was found.
 */
export function findPullRequests(entries: ConversationEntry[], explicit: string[] = []): string[] {
  const found = new Set<string>(explicit.map((p) => p.trim()).filter(Boolean));
  for (const entry of entries) {
    for (const url of entry.message.match(PR_URL_RE) ?? []) found.add(url);
  }
  if (found.size === 0) {
    for (const entry of entries) {
      for (const match of entry.message.matchAll(PR_REF_RE)) found.add(`#${match[1]}`);
    }
  }
  return [...found];
}

/** Branch, commit and authors of the latest merge submission. */
export function parseMergeRecord(entries: ConversationEntry[]): MergeRecord | null {
  const merge = [...entries].reverse().find((e) => e.messageType === "merge");
  if (!merge) return null;
  const text = merge.message;
  const pick = (re: RegExp) => text.match(re)?.[1]?.trim() || null;
  return {
    branch: pick(/Branch: ([^,\s]+)/),
    commit: pick(/Commit: ([^,\s]+)/),
    authors: pick(/Authors: ([\s\S]+?)(?:, Worktree: |, Message: |$)/),
    worktree: pick(/Worktree: ([\s\S]+?)(?:, Message: |$)/),
  };
}

/**
 * Base branch, commit and authors of the task's pull request: what submit_pr
 * recorded on it (the commit as the PR sync last saw it), else the merge
 * message, which is all older tasks have.
 */
export function mergeRecordOf(task: Task): MergeRecord | null {
  const parsed = parseMergeRecord(task.conversation);
  const pr = task.pullRequest;
  if (!parsed && !pr) return null;
  return {
    branch: pr?.base ?? parsed?.branch ?? null,
    commit: pr?.headSha ?? parsed?.commit ?? null,
    authors: pr?.authors ?? parsed?.authors ?? null,
    worktree: parsed?.worktree ?? null,
  };
}

const CLAIM_RE = /^Claimed task\. Transitioning to ([a-z_]+)\./;

/**
 * What a submission is called. A verification says how it went: its report starts
 * with the result, or says the verifier could not run.
 */
function submissionLabel(phase: SessionPhase, entry: ConversationEntry): string {
  if (phase.type !== "verify") return phase.submitted;
  const result = entry.message.match(/^## Verification (passed|skipped|failed)\b/)?.[1];
  if (result) return `Verification ${result}`;
  return /could not run/.test(entry.message) ? "Verification could not run" : phase.submitted;
}

/**
 * Every claim of the task, read from the conversation (claims are recorded
 * there by the agent id) and closed by the status history: a session ends at
 * the first transition out of the status the claim moved the task to. What the
 * session submitted is the first message of that phase's type before the next
 * claim; the task's next status is whatever the policy routed it to.
 */
export function extractAgentSessions(task: Task): AgentSession[] {
  const conversation = task.conversation;
  const claims = conversation.flatMap((entry, index) => {
    const match = entry.message.match(CLAIM_RE);
    return match ? [{ entry, index, status: match[1] }] : [];
  });
  /** History index of the latest claim into each status found so far. */
  const claimed = new Map<string, number>();

  return claims.map(({ entry, index, status }, k) => {
    // The claim wrote its history entry with the timestamp of its conversation entry. The session ends at the
    // first transition out of the status after it: comparing timestamps alone would give a claim made in the
    // same millisecond as the previous session's end that session's end.
    const entered = task.history.findIndex(
      (h, i) => i > (claimed.get(status) ?? -1) && h.new_status === status && h.timestamp === entry.timestamp,
    );
    if (entered >= 0) claimed.set(status, entered);
    const end =
      entered >= 0
        ? task.history.slice(entered + 1).find((h) => h.pre_status === status)
        : task.history.find((h) => h.pre_status === status && h.timestamp >= entry.timestamp);
    const nextClaim = claims[k + 1]?.index ?? conversation.length;
    const phase = SESSION_PHASES[status];
    let submissionIndex: number | null = null;
    for (let j = index + 1; phase && j < nextClaim; j++) {
      if (conversation[j].messageType === phase.type) {
        submissionIndex = j;
        break;
      }
    }
    return {
      agentId: entry.authorName,
      status,
      claimedAt: entry.timestamp,
      endedAt: end?.timestamp ?? null,
      endStatus: end?.new_status ?? null,
      claimIndex: index,
      submissionIndex,
      submitted: phase && submissionIndex !== null ? submissionLabel(phase, conversation[submissionIndex]) : null,
    };
  });
}

/** How a session ended: what it submitted and where the policy sent the task, or why it let go. */
function sessionOutcome(session: AgentSession): string {
  if (!session.endStatus) return "No end recorded";
  const to = archiveStatusLabel(session.endStatus);
  if (session.submitted) return `${session.submitted} → ${to}`;
  if (session.endStatus === TaskStatus.Canceled) return "Task canceled";
  if (session.endStatus === TaskStatus.NeedsHuman) return "Blocked (needs human)";
  return `Released without submitting (back to ${to})`;
}

function completedAt(task: Task): string | null {
  const done = [...task.history].reverse().find((h) => h.new_status === TaskStatus.Complete);
  return done?.timestamp ?? null;
}

function uniqueAgentIds(sessions: AgentSession[]): string[] {
  return [...new Set(sessions.map((s) => s.agentId))];
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function iterationsLine(task: Task): string | null {
  const count = (type: string) => task.conversation.filter((e) => e.messageType === type).length;
  const into = (status: string) => task.history.filter((h) => h.new_status === status).length;
  const parts = [
    count("refine") && plural(count("refine"), "refinement"),
    count("plan") && plural(count("plan"), "plan"),
    count("plan_review") && plural(count("plan_review"), "plan critique"),
    into(TaskStatus.PlanChangesRequested) &&
      plural(into(TaskStatus.PlanChangesRequested), "plan change request"),
    count("code") && plural(count("code"), "code submission"),
    count("verify") && plural(count("verify"), "verification"),
    count("review") && plural(count("review"), "AI review"),
    into(TaskStatus.ChangesRequested) &&
      plural(into(TaskStatus.ChangesRequested), "code change request"),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function pullRequestList(pullRequests: string[]): string {
  if (pullRequests.length === 0) return "—";
  return pullRequests.map((pr) => (/^https?:\/\//.test(pr) ? `<${pr}>` : pr)).join(", ");
}

function statusPath(history: StatusHistoryEntry[]): string | null {
  if (history.length === 0) return null;
  return [history[0].pre_status, ...history.map((h) => h.new_status)].map(archiveStatusLabel).join(" → ");
}

function projectLine(project: Project | null): string {
  return project ? `${project.displayName} (${inlineCode(project.workingDirectory)})` : "—";
}

function authorAndTime(entry: ConversationEntry): string {
  return `${inlineCode(entry.authorName)} · ${formatTimestamp(entry.timestamp)}`;
}

// ─── The flow's records ────────────────────────────────────────────────

/** How many findings the reviews raised and where they ended up: "3 (2 verified, 1 open)". */
function findingsText(findings: Finding[]): string {
  const counts = (["verified", "fixed", "wontfix", "open"] as const)
    .map((status) => [status, findings.filter((f) => f.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${status === "wontfix" ? "won't fix" : status}`);
  return `${findings.length} (${counts.join(", ")})`;
}

/** The first 12 characters of a commit, as code. */
function commitCode(sha: string | null | undefined): string {
  return sha ? inlineCode(sha.slice(0, 12)) : "—";
}

function riskText(task: Task): string {
  return task.riskReasons.length ? `${task.risk}: ${task.riskReasons.join("; ")}` : task.risk;
}

/** The level the task ran at: its own override, else its project's. */
function autonomyText(task: Task, project: Project | null): string {
  return AUTONOMY_LEVELS[resolvePolicy(project, task).level].label;
}

/** Who approved the plan and when: a person, or the critic (its agent id). */
function planApprovalText(plan: ApprovedPlan): string {
  const who = plan.approvedBy === HUMAN_ACTOR ? "a person" : "the plan critic";
  return `${who} (${inlineCode(plan.approvedBy)}) · ${formatTimestamp(plan.at)}`;
}

/** Who approved the code, which commit and when: a person, or the AI reviewer. */
function codeApprovalText(approval: Approval): string {
  const who = approval.human
    ? `a person (${inlineCode(approval.by)})`
    : `the AI reviewer (${inlineCode(approval.by)}, review ${approval.round})`;
  return `${who}${approval.sha ? ` on ${commitCode(approval.sha)}` : ""} · ${formatTimestamp(approval.at)}`;
}

/** The latest AI verdict; a code submission after it makes it about earlier code. */
function reviewText(review: LastReview): string {
  return (
    `**${review.verdict}** in round ${review.round} by ${inlineCode(review.by)}` +
    (review.sha ? ` on ${commitCode(review.sha)}` : "") +
    ` · ${formatTimestamp(review.at)}` +
    (review.stale ? " (the code was submitted again after it)" : "")
  );
}

/** The evidence of the task's latest verification (older records: every row of its round). */
function latestVerificationEvidence(task: Task, evidence: Evidence[]): Evidence[] {
  const v = task.verification;
  if (!v) return [];
  const ids = v.evidenceIds ? new Set(v.evidenceIds) : null;
  return evidence.filter((e) => (ids ? ids.has(e.id) : e.round === v.round));
}

/**
 * How the latest submission was verified, as the PR body says it: passed, failed
 * or not verified (with why), the commands behind it, and any test tampering.
 * Null for a task that was never verified (older tasks).
 */
function verificationLines(task: Task, evidence: Evidence[]): string[] | null {
  const v = task.verification;
  if (!v) return null;
  const lines = [
    v.skipped
      ? orNone(v.note, "Not verified.")
      : `${v.passed ? "✅ Passed" : "❌ Failed"} (round ${v.round})${v.verifiedSha ? ` on ${commitCode(v.verifiedSha)}` : ""}.`,
  ];
  const ran = latestVerificationEvidence(task, evidence);
  if (ran.length) lines.push("");
  for (const e of ran) {
    const mark = e.skipped ? "⏭" : e.exitCode === 0 ? "✅" : "❌";
    const what = e.command ? inlineCode(e.command) : e.summary.split("\n")[0];
    lines.push(
      `- ${mark} ${what}${e.criterionId ? ` (${e.criterionId})` : ""}` +
        (e.flaky ? " — flaky, passed on retry" : "") +
        (e.skipped && e.command ? ` — ${e.summary.split("\n")[0]}` : ""),
    );
  }
  if (v.tampering.length) lines.push("", "Test tampering found:", ...v.tampering.map((t) => `- ${t}`));
  return lines;
}

function evidenceTable(evidence: Evidence[]): string {
  return table(
    ["Id", "Round", "Criterion", "Kind", "Command", "Exit code", "Produced by", "Notes", "Output"],
    evidence.map((e) => [
      inlineCode(e.id),
      String(e.round),
      e.criterionId ?? "—",
      e.kind,
      e.command ? inlineCode(e.command) : "—",
      e.exitCode === null ? "—" : String(e.exitCode),
      inlineCode(e.producedBy),
      [e.skipped ? "skipped" : "", e.flaky ? "flaky" : "", e.logPath ? `log ${inlineCode(e.logPath)}` : ""].filter(Boolean).join(", ") || "—",
      orNone(e.summary),
    ]),
  );
}

function handoffList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "—";
}

function handoffTable(handoffs: Handoff[]): string {
  return table(
    ["Phase", "Round", "Agent", "When", "Summary", "Decisions", "Risks", "Next"],
    handoffs.map((h) => [
      HANDOFF_PHASE_LABELS[h.phase] ?? h.phase,
      String(h.round),
      inlineCode(h.agentId),
      formatTimestamp(h.createdAt),
      h.summary,
      handoffList(h.decisions),
      handoffList(h.risks),
      handoffList(h.next),
    ]),
  );
}

const COMMIT_PHASE_LABELS: Record<string, string> = {
  code: "Code submitted",
  verify: "Verified",
  pr: "Pull request head",
};

function commitTable(commits: Task["commits"]): string {
  return table(
    ["Round", "Phase", "Commit", "Branch", "When"],
    commits.map((c) => [
      String(c.round),
      COMMIT_PHASE_LABELS[c.phase] ?? c.phase,
      inlineCode(c.sha),
      c.branch ? inlineCode(c.branch) : "—",
      formatTimestamp(c.at),
    ]),
  );
}

function subtaskTable(subtasks: Task[]): string {
  return table(
    ["Id", "Title", "Status", "Pull request"],
    subtasks.map((c) => [
      inlineCode(c.id),
      c.title,
      archiveStatusLabel(c.status),
      c.pullRequest?.url ? `<${c.pullRequest.url}>` : "—",
    ]),
  );
}

function pullRequestFacts(pr: PullRequest): string[] {
  const merged = pr.mergedAt ? ` (${formatTimestamp(pr.mergedAt)}${pr.mergedBy ? ` by ${inlineCode(pr.mergedBy)}` : ""})` : "";
  const list = (names: string[] | undefined) => (names?.length ? names.map(inlineCode).join(", ") : "none");
  return [
    `- **URL:** ${pr.url ? `<${pr.url}>` : "—"}`,
    `- **Number:** ${pr.number === null ? "—" : `#${pr.number}`}`,
    `- **State:** ${pr.state}${merged}`,
    `- **Base branch:** ${codeOrNone(pr.base)}`,
    `- **Head branch:** ${codeOrNone(pr.branch)}`,
    `- **Head commit:** ${codeOrNone(pr.headSha)}`,
    `- **Authors:** ${orNone(pr.authors)}`,
    `- **Checks:** ${pr.checks ?? "—"}${pr.checkedAt ? ` (${formatTimestamp(pr.checkedAt)})` : ""}`,
    `- **Changes requested by:** ${list(pr.changesRequestedBy)}`,
    `- **Ever asked for changes:** ${list(pr.changesEverRequestedBy)}`,
  ];
}

/** One visit of the task to a person: who sent it, from which status, and how it came back. */
export interface BlockerVisit {
  at: string;
  from: string;
  by: string | null;
  resolvedAt: string | null;
  to: string | null;
  resolvedBy: string | null;
  /** What the person wrote when sending it on; null when they wrote nothing. */
  answer: string | null;
}

/**
 * Every time the task went to a person (`needs_human`), read from the status history.
 * The person's answer is the message written with the transition that sent it on,
 * so it has that transition's timestamp.
 */
export function blockerVisits(task: Task): BlockerVisit[] {
  return task.history.flatMap((h, i) => {
    if (h.new_status !== TaskStatus.NeedsHuman) return [];
    const back = task.history.slice(i + 1).find((x) => x.pre_status === TaskStatus.NeedsHuman);
    // Another message of a person can share the millisecond: the answer is the one that resolves the blocker.
    const answer = task.conversation
      .filter((e) => back && e.timestamp === back.timestamp && e.messageType === "user")
      .map((e) => e.message.match(/^\*\*Blocker resolved\*\*[^\n]*\n+([\s\S]+)$/)?.[1].trim())
      .find(Boolean);
    return [
      {
        at: h.timestamp,
        from: h.pre_status,
        by: h.actor ?? null,
        resolvedAt: back?.timestamp ?? null,
        to: back?.new_status ?? null,
        resolvedBy: back?.actor ?? null,
        answer: answer || null,
      },
    ];
  });
}

function blockerTable(visits: BlockerVisit[]): string {
  return table(
    ["#", "Sent to a person", "From", "By", "Answered", "Sent on to", "By", "Answer"],
    visits.map((v, i) => [
      String(i + 1),
      formatTimestamp(v.at),
      archiveStatusLabel(v.from),
      v.by ? inlineCode(v.by) : "—",
      formatTimestamp(v.resolvedAt),
      v.to ? archiveStatusLabel(v.to) : "—",
      v.resolvedBy ? inlineCode(v.resolvedBy) : "—",
      orNone(v.answer),
    ]),
  );
}

// ─── Documents ─────────────────────────────────────────────────────────

export function buildArchiveDocuments(input: ArchiveDocumentsInput): ArchiveDocuments {
  return { summary: renderSummary(input), detailed: renderDetailed(input) };
}

function renderSummary(input: ArchiveDocumentsInput): string {
  const { task, project, archivedAt, pullRequests } = input;
  const sessions = extractAgentSessions(task);
  const merge = mergeRecordOf(task);
  const done = completedAt(task);
  const agentIds = uniqueAgentIds(sessions);
  const iterations = iterationsLine(task);
  const branch =
    inlineCode(task.recommendedBranch || "—") +
    (task.realBranch && task.realBranch !== task.recommendedBranch
      ? ` (worked on ${inlineCode(task.realBranch)})`
      : "");

  const out: string[] = [
    `# ${task.title}`,
    "",
    `> Archived from Moonlight Task Queue on ${formatTimestamp(archivedAt)}. This is the summary; every message, ` +
      `status change, agent session and activity event is in ` +
      `[${input.detailedFile}](./${input.detailedFile}).`,
    "",
    `- **Task:** ${inlineCode(task.id)}`,
    `- **Project:** ${projectLine(project)}`,
    `- **Status:** ${archiveStatusLabel(task.status)}`,
    `- **Priority:** P${task.priority}`,
    `- **Autonomy:** ${autonomyText(task, project)}`,
    `- **Risk:** ${riskText(task)}`,
    ...(task.parentId ? [`- **Parent task:** ${inlineCode(task.parentId)}`] : []),
    `- **Branch:** ${branch}`,
    `- **Merge target:** ${inlineCode(task.mergeBranch)}`,
    `- **Pull request:** ${pullRequestList(pullRequests)}`,
    `- **Commit:** ${codeOrNone(merge?.commit)}`,
    `- **Authors:** ${orNone(merge?.authors)}`,
    ...(task.approvedPlan ? [`- **Plan approved by:** ${planApprovalText(task.approvedPlan)}`] : []),
    ...(task.approval ? [`- **Code approved by:** ${codeApprovalText(task.approval)}`] : []),
    `- **Agents:** ${agentIds.length ? agentIds.map(inlineCode).join(", ") : "—"}`,
    ...(iterations ? [`- **Iterations:** ${iterations}`] : []),
    ...(input.findings?.length ? [`- **Findings:** ${findingsText(input.findings)}`] : []),
    `- **Created:** ${formatTimestamp(task.createdAt)}`,
    `- **Completed:** ${formatTimestamp(done)}` +
      (done ? ` (lead time ${durationBetween(task.createdAt, done)})` : ""),
    `- **Archived:** ${formatTimestamp(archivedAt)}`,
  ];

  if (input.overview?.trim()) {
    out.push("", "## Overview", "", embedMarkdown(input.overview, 3));
  }

  out.push(
    "",
    "## Description",
    "",
    task.description?.trim() ? embedMarkdown(task.description, 3) : "_No description._",
    "",
    "## Acceptance criteria",
    "",
    task.acceptanceCriteria.length
      ? task.acceptanceCriteria.map((c) => `- ${criterionLine(c)}`).join("\n")
      : "_None._",
    "",
    "## What was done",
  );

  // The phases the task went through, in flow order: which of them ran depends on the autonomy level.
  const sections: Array<[string, string]> = [
    ["Refinement", "refine"],
    ["Plan", "plan"],
    ["Plan critique", "plan_review"],
    ["Implementation", "code"],
    ["Verification", "verify"],
    ["Review", "review"],
    ["Merge", "merge"],
  ];
  let wroteAny = false;
  for (const [title, type] of sections) {
    if (type === "verify") {
      // The task's latest record, not a report: code submitted again and never verified must not
      // show the report of an earlier round as its result.
      const lines = verificationLines(task, input.evidence ?? []);
      if (lines) {
        wroteAny = true;
        out.push("", `### ${title}`, "", ...lines);
      }
      continue;
    }
    const entries = task.conversation.filter((e) => e.messageType === type);
    const latest = entries[entries.length - 1];
    if (!latest) continue;
    wroteAny = true;
    if (type === "plan" && task.approvedPlan) {
      // The plan that was approved is the one that was built, however many rounds it took to get there.
      const rounds = entries.length > 1 ? ` · ${plural(entries.length, "plan")} submitted` : "";
      out.push("", `### ${title}`, "", `_Approved by ${planApprovalText(task.approvedPlan)}${rounds}_`, "");
      out.push(embedMarkdown(task.approvedPlan.markdown, 4));
      continue;
    }
    const rounds = entries.length > 1 ? ` · latest of ${entries.length}` : "";
    out.push("", `### ${title}`, "", `_${authorAndTime(latest)}${rounds}_`, "");
    if (type === "review" && task.lastReview) out.push(`Latest AI verdict: ${reviewText(task.lastReview)}.`, "");
    // "PR opened: <url>. Branch: …, Commit: …, Authors: …, Message: <markdown>" (older
    // tasks: "Merge submitted. …") reads better as facts followed by the agent's message.
    const mergeBody = type === "merge" ? latest.message.match(/, Message: ([\s\S]*)$/) : null;
    if (type === "merge" && merge && /^(PR opened|Merge submitted)\b/.test(latest.message)) {
      const prUrl = task.pullRequest?.url ?? latest.message.match(PR_URL_RE)?.[0];
      if (prUrl) out.push(`- **Pull request:** <${prUrl}>`);
      out.push(
        `- **Base branch:** ${codeOrNone(merge.branch)}`,
        `- **Commit:** ${codeOrNone(merge.commit)}`,
        `- **Authors:** ${orNone(merge.authors)}`,
      );
      if (mergeBody?.[1].trim()) out.push("", embedMarkdown(mergeBody[1], 4));
    } else {
      out.push(embedMarkdown(latest.message, 4));
    }
  }
  if (!wroteAny) {
    out.push("", "_No plan, code, review or merge submissions were recorded._");
  }

  if (input.subtasks?.length) out.push("", "## Subtasks", "", subtaskTable(input.subtasks));

  out.push("", "## Agents", "");
  if (sessions.length) {
    out.push(
      table(
        ["#", "Phase", "Agent", "Claimed", "Duration", "Outcome"],
        sessions.map((s, i) => [
          String(i + 1),
          phaseLabel(s.status),
          inlineCode(s.agentId),
          formatTimestamp(s.claimedAt),
          durationBetween(s.claimedAt, s.endedAt),
          sessionOutcome(s),
        ]),
      ),
    );
  } else {
    out.push("_No agent claimed this task._");
  }

  const path = statusPath(task.history);
  if (path) out.push("", "## Status path", "", path);

  return out.join("\n") + "\n";
}

function renderDetailed(input: ArchiveDocumentsInput): string {
  const { task, project, archivedAt, pullRequests } = input;
  const sessions = extractAgentSessions(task);
  const merge = mergeRecordOf(task);
  const done = completedAt(task);

  const out: string[] = [
    `# ${task.title} — full record`,
    "",
    `> Archived from Moonlight Task Queue on ${formatTimestamp(archivedAt)}. ` +
      `Summary: [${input.summaryFile}](./${input.summaryFile}).`,
    "",
    "## Task",
    "",
    `- **ID:** ${inlineCode(task.id)}`,
    `- **Title:** ${task.title}`,
    `- **Project:** ${
      project
        ? `${project.displayName} · id ${inlineCode(project.id)} · ${inlineCode(project.workingDirectory)}`
        : codeOrNone(task.projectId)
    }`,
    `- **Status:** ${archiveStatusLabel(task.status)}`,
    `- **Priority:** P${task.priority}`,
    `- **Requires plan:** ${task.requiresPlan ? "Yes" : "No"}`,
    `- **Type:** ${task.type}`,
    `- **Risk:** ${riskText(task)}`,
    `- **Autonomy:** ${autonomyText(task, project)}${task.autonomy === null ? "" : " (set on the task)"}`,
    ...(task.parentId ? [`- **Parent task:** ${inlineCode(task.parentId)}`] : []),
    ...(task.blockedBy.length ? [`- **Starts after:** ${task.blockedBy.map(inlineCode).join(", ")}`] : []),
    `- **Recommended branch:** ${codeOrNone(task.recommendedBranch)}`,
    `- **Working branch:** ${codeOrNone(task.realBranch)}`,
    `- **Merge target:** ${inlineCode(task.mergeBranch)}`,
    `- **Worktree:** ${codeOrNone(task.worktreePath ?? merge?.worktree)}`,
    `- **Pull requests:** ${pullRequestList(pullRequests)}`,
    `- **Merge base recorded:** ${codeOrNone(merge?.branch)}`,
    `- **Commit:** ${codeOrNone(merge?.commit)}`,
    `- **Authors:** ${orNone(merge?.authors)}`,
    `- **Created:** ${formatTimestamp(task.createdAt)}`,
    `- **Last updated:** ${formatTimestamp(task.updatedAt)}`,
    `- **Completed:** ${formatTimestamp(done)}`,
    `- **Lead time:** ${durationBetween(task.createdAt, done)}`,
    `- **Archived:** ${formatTimestamp(archivedAt)}`,
    "",
    "## Description",
    "",
    task.description?.trim() ? embedMarkdown(task.description, 3) : "_No description._",
    "",
    "## Steer details",
    "",
    task.steerDetails?.trim() ? embedMarkdown(task.steerDetails, 3) : "_None._",
    "",
    "## Guardrails",
    "",
    task.guardrails.length ? task.guardrails.map((g, i) => `${i + 1}. ${g}`).join("\n") : "_None._",
    "",
    "## Non-goals",
    "",
    task.nonGoals.length ? task.nonGoals.map((g) => `- ${g}`).join("\n") : "_None._",
    "",
    "## References",
    "",
    task.references.length ? task.references.map((r) => `- ${r.label}: ${r.target}`).join("\n") : "_None._",
    "",
    "## Acceptance criteria",
    "",
    task.acceptanceCriteria.length
      ? task.acceptanceCriteria.map((c) => `- ${criterionLine(c, true)}`).join("\n")
      : "_None._",
    "",
    "## Context notes",
    "",
    "Notes agents appended with `--context` for the next agent, oldest first.",
  ];
  if (task.contexts.length) {
    task.contexts.forEach((context, i) => {
      out.push("", `### Note ${i + 1}`, "", embedMarkdown(context, 4));
    });
  } else {
    out.push("", "_None._");
  }

  // Approved plan
  out.push("", "## Approved plan", "");
  const plan = task.approvedPlan;
  if (plan) {
    out.push(`Approved by ${planApprovalText(plan)}.`, "", embedMarkdown(plan.markdown, 3));
    if (plan.validation) {
      out.push("", "### Validation plan", "");
      out.push(
        plan.validation.items.length
          ? table(
              ["Criterion", "How", "Command", "New tests"],
              plan.validation.items.map((item) => [
                item.criterionId,
                item.how,
                item.command ? inlineCode(item.command) : "—",
                item.newTests?.length ? item.newTests.map(inlineCode).join(", ") : "—",
              ]),
            )
          : "_No per-criterion checks._",
      );
      if (plan.validation.regressionCommands.length) {
        out.push("", `Regression commands: ${plan.validation.regressionCommands.map(inlineCode).join(", ")}.`);
      }
    }
  } else {
    out.push("_No plan was approved._");
  }

  // Agents
  out.push("", "## Agent history", "", "### Agents", "");
  const agentIds = uniqueAgentIds(sessions);
  if (agentIds.length) {
    const byId = new Map(input.agents.map((a) => [a.id, a]));
    out.push(
      table(
        ["Agent", "Tool", "Version", "Model", "Role", "Session", "Host", "Last seen", "Claims"],
        agentIds.map((id) => {
          const agent = byId.get(id);
          const claims = sessions.filter((s) => s.agentId === id);
          const phases = [...new Set(claims.map((s) => phaseLabel(s.status)))];
          return [
            inlineCode(id),
            agent?.toolName ?? "—",
            agent?.version ?? "—",
            agent?.model ?? "—",
            agent?.role ?? "—",
            codeOrNone(agent?.sessionId),
            orNone(agent?.host),
            formatTimestamp(agent?.lastSeen),
            `${claims.length} (${phases.join(", ")})`,
          ];
        }),
      ),
      "",
      "_Role, session and host are the latest ones registered under each agent id._",
    );
  } else {
    out.push("_No agent claimed this task._");
  }

  out.push("", "### Sessions", "");
  if (sessions.length) {
    out.push(
      table(
        ["#", "Phase", "Agent", "Claimed", "Ended", "Duration", "Outcome", "Submission"],
        sessions.map((s, i) => [
          String(i + 1),
          phaseLabel(s.status),
          inlineCode(s.agentId),
          formatTimestamp(s.claimedAt),
          formatTimestamp(s.endedAt),
          durationBetween(s.claimedAt, s.endedAt),
          sessionOutcome(s),
          s.submissionIndex !== null ? `Message ${s.submissionIndex + 1}` : "—",
        ]),
      ),
    );
  } else {
    out.push("_None._");
  }

  if (input.runnerJobs?.length) {
    out.push(
      "",
      "### Runner jobs",
      "",
      table(
        ["Runner", "Tool", "Phase", "Status", "Started", "Finished", "Exit code", "Log"],
        [...input.runnerJobs]
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          .map((job) => [
            job.runnerName,
            job.tool,
            job.phase,
            job.status,
            formatTimestamp(job.startedAt),
            formatTimestamp(job.finishedAt),
            job.exitCode === null || job.exitCode === undefined ? "—" : String(job.exitCode),
            inlineCode(job.logPath),
          ]),
      ),
    );
  }

  // Status history
  out.push("", "## Status history", "");
  if (task.history.length) {
    out.push(
      table(
        ["#", "When", "From", "To", "By", "Time in previous status"],
        task.history.map((h, i) => [
          String(i + 1),
          formatTimestamp(h.timestamp),
          archiveStatusLabel(h.pre_status),
          archiveStatusLabel(h.new_status),
          h.actor ? inlineCode(h.actor) : "—",
          durationBetween(i === 0 ? task.createdAt : task.history[i - 1].timestamp, h.timestamp),
        ]),
      ),
    );
  } else {
    out.push("_No status changes were recorded._");
  }

  // Blockers
  const visits = blockerVisits(task);
  if (visits.length) {
    out.push(
      "",
      "## Blockers and answers",
      "",
      "Every time the task went to a person. What was asked is in the conversation at that time.",
      "",
      blockerTable(visits),
    );
  }

  // Verification
  const evidence = input.evidence ?? [];
  const verification = verificationLines(task, evidence);
  if (verification || evidence.length) {
    out.push("", "## Verification", "", ...(verification ?? ["_Not verified by Moonlight Task Queue._"]));
    if (task.diffStats) {
      out.push("", `Diff: ${task.diffStats.files} files, +${task.diffStats.insertions} −${task.diffStats.deletions}.`);
    }
    if (evidence.length) out.push("", "### Evidence", "", evidenceTable(evidence));
  }

  // Review findings
  const findings = input.findings ?? [];
  if (findings.length) {
    out.push(
      "",
      "## Review findings",
      "",
      "Ids: `P` plan critique, `R` code review, `H` a person. The answer is what the planner or the coder replied; " +
        "verified means a reviewer checked it.",
      "",
    );
    out.push(
      table(
        ["Id", "Phase", "Severity", "Status", "Where", "Raised by", "Finding", "Answer"],
        findings.map((f) => [
          inlineCode(f.id),
          f.phase === "plan" ? "Plan" : "Code",
          f.severity,
          f.status + (f.reopenCount ? ` (reopened ×${f.reopenCount})` : ""),
          f.file ? inlineCode(f.line ? `${f.file}:${f.line}` : f.file) : "—",
          inlineCode(f.raisedBy),
          f.text.replace(/\s+/g, " "),
          f.resolution ? f.resolution.replace(/\s+/g, " ") : "—",
        ]),
      ),
    );
  }

  // Review and approval
  out.push(
    "",
    "## Review and approval",
    "",
    `- **Plan critiques:** ${task.planRound}`,
    `- **AI reviews:** ${task.codeRound}`,
    ...(task.lastReview ? [`- **Latest AI verdict:** ${reviewText(task.lastReview)}`] : []),
    ...(task.approval ? [`- **Code approved by:** ${codeApprovalText(task.approval)}`] : ["- **Code approved by:** —"]),
  );

  // Pull request and commits
  if (task.pullRequest) out.push("", "## Pull request", "", ...pullRequestFacts(task.pullRequest));
  if (task.commits.length) {
    out.push("", "## Commits", "", "Every commit the work went through, oldest first.", "", commitTable(task.commits));
  }

  // Handoffs
  const handoffs = input.handoffs ?? [];
  if (handoffs.length) {
    out.push("", "## Handoffs", "", "Notes each phase left for the next, and the answers people gave, oldest first.", "", handoffTable(handoffs));
  }

  if (input.subtasks?.length) out.push("", "## Subtasks", "", subtaskTable(input.subtasks));

  // Conversation
  out.push("", "## Conversation", "");
  if (task.conversation.length) {
    out.push("Every message on the task, oldest first.");
    task.conversation.forEach((entry, i) => {
      const type = MESSAGE_TYPE_LABELS[entry.messageType ?? "agent"] ?? entry.messageType;
      out.push("", `### ${i + 1}. ${type}`, "", `_${authorAndTime(entry)}_`, "");
      out.push(embedMarkdown(entry.message, 4));
    });
  } else {
    out.push("_No messages._");
  }

  // Activity
  out.push("", "## Activity log", "");
  const activity = [...input.activity].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
  );
  if (activity.length) {
    out.push(
      table(
        ["When", "Event", "Actor", "Details"],
        activity.map((e) => [
          formatTimestamp(e.createdAt),
          inlineCode(e.eventType),
          orNone(e.actor),
          orNone(e.details),
        ]),
      ),
    );
  } else {
    out.push("_No activity events._");
  }

  out.push(
    "",
    "## Raw data",
    "",
    "<details>",
    "<summary>Task, project, findings, evidence and handoffs as stored in Moonlight Task Queue</summary>",
    "",
    fenced(JSON.stringify({ task, project, findings, evidence, handoffs }, null, 2), "json"),
    "",
    "</details>",
  );

  return out.join("\n") + "\n";
}

// ─── Archiving ─────────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** The folder a task is archived into: `directory` when given, else {project}/archive. */
export function resolveArchiveDirectory(project: Project | null, directory?: string): string {
  if (directory) return resolve(expandHome(directory));
  if (!project) {
    throw new WorkflowError("Task has no project, so there is no project folder to archive into.");
  }
  const root = resolve(expandHome(project.workingDirectory));
  if (!existsSync(root)) {
    throw new WorkflowError(`Project working directory not found: ${root}`);
  }
  return join(root, ARCHIVE_DIR_NAME);
}

/** `2026-09-22-1a2b3c4d-fix-login-bug`: sorts by archive date, stays unique per task. */
export function archiveBaseName(task: Pick<Task, "id" | "title">, archivedAt: string): string {
  return `${archivedAt.slice(0, 10)}-${task.id.slice(0, 8)}-${slugify(task.title) || "task"}`;
}

/**
 * Writes a complete task to two Markdown files in the project's archive folder
 * (`<name>.summary.md` and `<name>.detailed.md`), then marks the task archived,
 * which takes it off the board. Re-archiving (with `force`) rewrites the same
 * files when they are still in the same folder.
 */
export function archiveTask(taskId: string, options: ArchiveTaskOptions = {}): ArchiveTaskResult {
  const task = getTaskById(taskId);
  if (!task || task.deletedAt) {
    throw new WorkflowError("Task not found.");
  }
  if (!ARCHIVABLE_STATUSES.has(task.status)) {
    throw new WorkflowError(
      `Only complete tasks can be archived; this one is ${archiveStatusLabel(task.status)}.`,
    );
  }
  if (task.archivedAt && !options.force) {
    throw new WorkflowError(
      `Task is already archived (${task.archivePath}). Archive it again with force.`,
    );
  }

  const project = task.projectId ? getProjectById(task.projectId) : null;
  const directory = resolveArchiveDirectory(project, options.directory);
  const archivedAt = new Date().toISOString();
  const previous =
    task.archivePath && dirname(task.archivePath) === directory
      ? basename(task.archivePath).replace(/\.summary\.md$/, "")
      : null;
  const base = previous || archiveBaseName(task, archivedAt);
  const summaryFile = `${base}.summary.md`;
  const detailedFile = `${base}.detailed.md`;

  const sessions = extractAgentSessions(task);
  const agents = uniqueAgentIds(sessions)
    .map((id) => getAgentById(id))
    .filter((a): a is Agent => a !== null);
  // The recorded PR first (structured since phase 5), then any given or mentioned ones.
  const recorded = task.pullRequest?.url ? [task.pullRequest.url] : [];
  // The caller's PRs first, then the one submit_pr recorded, then any found in messages.
  const pullRequests = findPullRequests(task.conversation, [...(options.pullRequests ?? []), ...recorded]);
  const documents = buildArchiveDocuments({
    task,
    project,
    agents,
    activity: getActivityEvents({ taskId: task.id }),
    archivedAt,
    summaryFile,
    detailedFile,
    pullRequests,
    overview: options.overview,
    runnerJobs: options.runnerJobs,
    findings: getFindings(task.id),
    evidence: getEvidence(task.id),
    handoffs: getHandoffs(task.id),
    subtasks: getSubtasks(task.id),
  });

  const summaryPath = join(directory, summaryFile);
  const detailedPath = join(directory, detailedFile);
  mkdirSync(directory, { recursive: true });
  writeFileSync(summaryPath, documents.summary);
  writeFileSync(detailedPath, documents.detailed);

  const actor = options.actor ?? "user";
  setTaskArchive(task.id, archivedAt, summaryPath);
  const updated = addConversation(
    getTaskById(task.id)!,
    actor,
    `Task archived.\n\n- Summary: ${inlineCode(summaryPath)}\n- Full record: ${inlineCode(detailedPath)}`,
    "system",
  );
  addActivity(task.id, "task_archived", actor, summaryPath);

  return { task: updated, directory, summaryPath, detailedPath, pullRequests };
}

/**
 * Archives a task that just completed when its project archives automatically
 * (profile `autoArchive`): after a merge seen on GitHub, an L3 auto-merge or a
 * person's "Mark merged". The merge already happened, so a failure is recorded
 * as an `archive_failed` event on the task instead of thrown. Returns the
 * archive, or null when nothing was archived.
 */
export function archiveIfAuto(
  taskId: string,
  options: Pick<ArchiveTaskOptions, "pullRequests" | "runnerJobs"> = {},
): ArchiveTaskResult | null {
  const task = getTaskById(taskId);
  const project = task?.projectId ? getProjectById(task.projectId) : null;
  if (!task || task.archivedAt || !resolveProfile(project?.profile).autoArchive) return null;
  try {
    return archiveTask(taskId, { ...options, actor: "system" });
  } catch (e) {
    addActivity(taskId, "archive_failed", "system", e instanceof Error ? e.message : String(e));
    return null;
  }
}
