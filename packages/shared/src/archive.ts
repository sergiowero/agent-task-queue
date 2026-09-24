import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import {
  getActivityEvents,
  getAgentById,
  getProjectById,
  getTaskById,
  setTaskArchive,
  slugify,
} from "./database.js";
import { getFindings } from "./records.js";
import type {
  AcceptanceCriterion,
  ActivityEvent,
  Agent,
  ConversationEntry,
  Finding,
  Project,
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
  /** Active status the claim moved the task to: planning, coding, reviewing or merging. */
  status: string;
  claimedAt: string;
  endedAt: string | null;
  /** Status the task moved to when the session ended, e.g. waiting_code_review. */
  endStatus: string | null;
  /** Index in task.conversation of the claim entry. */
  claimIndex: number;
  /** Index in task.conversation of the plan/code/review/merge submission, if any. */
  submissionIndex: number | null;
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
  /** Review findings of the task (plan and code reviews). */
  findings?: Finding[];
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

/** One criterion for the archive: status mark, id, text and how it was checked. */
function criterionLine(c: AcceptanceCriterion): string {
  const mark = { met: "✅", failed: "❌", waived: "➖", pending: "⬜" }[c.status] ?? "⬜";
  const how = c.verify.command ? ` — \`${c.verify.command}\`` : c.verify.kind !== "review" ? ` — ${c.verify.kind}` : "";
  return `${mark} **${c.id}** ${c.text}${how}`;
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

const PHASE_LABELS: Record<string, string> = {
  planning: "Planning",
  coding: "Coding",
  reviewing: "Review",
  merging: "Merge",
};

/** Conversation message type each active status is submitted with. */
const SUBMISSION_TYPE: Record<string, string> = {
  planning: "plan",
  coding: "code",
  reviewing: "review",
  merging: "merge",
};

/** Where each active status goes when its agent submits. */
const SUBMITTED_TO: Record<string, { status: string; label: string }> = {
  planning: { status: TaskStatus.WaitingPlanReview, label: "Plan submitted" },
  coding: { status: TaskStatus.WaitingCodeReview, label: "Code submitted" },
  reviewing: { status: TaskStatus.WaitingCodeReview, label: "Review submitted" },
  merging: { status: TaskStatus.PrOpen, label: "PR opened" },
};

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  user: "User",
  agent: "Agent note",
  plan: "Plan",
  code: "Code submission",
  review: "Review",
  merge: "Merge",
  system: "System",
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

const CLAIM_RE = /^Claimed task\. Transitioning to ([a-z_]+)\./;

/**
 * Every claim of the task, read from the conversation (claims are recorded
 * there by the agent id) and closed by the status history: a session ends at
 * the first transition out of the status the claim moved the task to.
 */
export function extractAgentSessions(task: Task): AgentSession[] {
  const conversation = task.conversation;
  const claims = conversation.flatMap((entry, index) => {
    const match = entry.message.match(CLAIM_RE);
    return match ? [{ entry, index, status: match[1] }] : [];
  });

  return claims.map(({ entry, index, status }, k) => {
    const end = task.history.find((h) => h.pre_status === status && h.timestamp >= entry.timestamp);
    const nextClaim = claims[k + 1]?.index ?? conversation.length;
    let submissionIndex: number | null = null;
    for (let j = index + 1; j < nextClaim; j++) {
      if (conversation[j].messageType === SUBMISSION_TYPE[status]) {
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
    };
  });
}

function sessionOutcome(session: AgentSession): string {
  if (!session.endStatus) return "No end recorded";
  const submitted = SUBMITTED_TO[session.status];
  if (submitted && submitted.status === session.endStatus) return submitted.label;
  if (session.endStatus === TaskStatus.Canceled) return "Task canceled";
  if (session.endStatus === TaskStatus.NeedsHuman) return "Blocked (needs human)";
  return `Released without submitting (back to ${archiveStatusLabel(session.endStatus)})`;
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
    count("plan") && plural(count("plan"), "plan"),
    into(TaskStatus.PlanChangesRequested) &&
      plural(into(TaskStatus.PlanChangesRequested), "plan change request"),
    count("code") && plural(count("code"), "code submission"),
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

// ─── Documents ─────────────────────────────────────────────────────────

export function buildArchiveDocuments(input: ArchiveDocumentsInput): ArchiveDocuments {
  return { summary: renderSummary(input), detailed: renderDetailed(input) };
}

function renderSummary(input: ArchiveDocumentsInput): string {
  const { task, project, archivedAt, pullRequests } = input;
  const sessions = extractAgentSessions(task);
  const merge = parseMergeRecord(task.conversation);
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
    `> Archived from AgentQ on ${formatTimestamp(archivedAt)}. This is the summary; every message, ` +
      `status change, agent session and activity event is in ` +
      `[${input.detailedFile}](./${input.detailedFile}).`,
    "",
    `- **Task:** ${inlineCode(task.id)}`,
    `- **Project:** ${projectLine(project)}`,
    `- **Status:** ${archiveStatusLabel(task.status)}`,
    `- **Priority:** P${task.priority}`,
    `- **Branch:** ${branch}`,
    `- **Merge target:** ${inlineCode(task.mergeBranch)}`,
    `- **Pull request:** ${pullRequestList(pullRequests)}`,
    `- **Commit:** ${codeOrNone(merge?.commit)}`,
    `- **Authors:** ${orNone(merge?.authors)}`,
    `- **Agents:** ${agentIds.length ? agentIds.map(inlineCode).join(", ") : "—"}`,
    ...(iterations ? [`- **Iterations:** ${iterations}`] : []),
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

  const sections: Array<[string, string]> = [
    ["Plan", "plan"],
    ["Implementation", "code"],
    ["Review", "review"],
    ["Merge", "merge"],
  ];
  let wroteAny = false;
  for (const [title, type] of sections) {
    const entries = task.conversation.filter((e) => e.messageType === type);
    const latest = entries[entries.length - 1];
    if (!latest) continue;
    wroteAny = true;
    const rounds = entries.length > 1 ? ` · latest of ${entries.length}` : "";
    out.push("", `### ${title}`, "", `_${authorAndTime(latest)}${rounds}_`, "");
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

  out.push("", "## Agents", "");
  if (sessions.length) {
    out.push(
      table(
        ["#", "Phase", "Agent", "Claimed", "Duration", "Outcome"],
        sessions.map((s, i) => [
          String(i + 1),
          PHASE_LABELS[s.status] ?? archiveStatusLabel(s.status),
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
  const merge = parseMergeRecord(task.conversation);
  const done = completedAt(task);

  const out: string[] = [
    `# ${task.title} — full record`,
    "",
    `> Archived from AgentQ on ${formatTimestamp(archivedAt)}. ` +
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
    "## Acceptance criteria",
    "",
    task.acceptanceCriteria.length
      ? task.acceptanceCriteria.map((c) => `- ${criterionLine(c)}`).join("\n")
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
          const phases = [...new Set(claims.map((s) => PHASE_LABELS[s.status] ?? s.status))];
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
          PHASE_LABELS[s.status] ?? archiveStatusLabel(s.status),
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

  // Review findings
  const findings = input.findings ?? [];
  if (findings.length) {
    out.push("", "## Review findings", "");
    out.push(
      table(
        ["Id", "Severity", "Status", "Where", "Finding"],
        findings.map((f) => [
          inlineCode(f.id),
          f.severity,
          f.status + (f.reopenCount ? ` (reopened ×${f.reopenCount})` : ""),
          f.file ? inlineCode(f.line ? `${f.file}:${f.line}` : f.file) : "—",
          f.text.replace(/\s+/g, " ") + (f.resolution ? ` — _${f.resolution.replace(/\s+/g, " ")}_` : ""),
        ]),
      ),
    );
  }

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
    "<summary>Task and project as stored in AgentQ</summary>",
    "",
    fenced(JSON.stringify({ task, project }, null, 2), "json"),
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
