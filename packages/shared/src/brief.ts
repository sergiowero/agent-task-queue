/**
 * What an agent needs to continue a task, without rereading the whole
 * conversation: the approved plan and its validation, criteria with status,
 * open findings, the latest handoff of each phase, the project's commands,
 * the round, and what people said since the last submission.
 * Its size stays flat as rounds pile up; get_task still has everything.
 */
import { getProjectById, getTaskById } from "./database.js";
import { TASK_TYPES, TaskStatus, type Phase } from "./catalog.js";
import { getEvidence, getFindings, latestHandoffs } from "./records.js";
import { resolveProfile, type ProjectCommands } from "./profile.js";
import { resolvePolicy, reviewRoundsUsed } from "./policy.js";
import type {
  AcceptanceCriterion,
  ApprovedPlan,
  ConversationEntry,
  Evidence,
  Finding,
  Handoff,
  Task,
  TaskReference,
  Verification,
} from "./types.js";

export interface TaskBrief {
  task: {
    id: string;
    title: string;
    type: Task["type"];
    risk: Task["risk"];
    status: Task["status"];
    description: string | null;
    steerDetails: string | null;
    nonGoals: string[];
    references: TaskReference[];
    recommendedBranch: string;
    realBranch: string | null;
    mergeBranch: string;
    worktreePath: string | null;
    headSha: string | null;
  };
  project: { id: string; displayName: string; workingDirectory: string } | null;
  /** What to do differently for this type of task. */
  typeGuidance: string;
  /** The project's shared guardrails first, then the task's. */
  guardrails: string[];
  commands: ProjectCommands;
  criteria: AcceptanceCriterion[];
  approvedPlan: ApprovedPlan | null;
  /** The latest plan while no plan is approved yet (planner revisions, plan reviews). */
  latestPlan: string | null;
  /** Findings not yet verified as fixed, newest round last. */
  openFindings: Finding[];
  /** The newest handoff of each phase. */
  handoffs: Handoff[];
  /** What people wrote since the last agent submission (change requests, answers, comments). */
  humanNotes: { author: string; at: string; message: string }[];
  round: {
    planRound: number;
    codeRound: number;
    reviewRoundsUsed: number;
    maxReviewRounds: number;
    remainingReviewRounds: number;
  };
  verification: (Verification & { failing: Pick<Evidence, "command" | "exitCode" | "summary">[] }) | null;
  /** What a person answered to the last blocker, if the task was blocked. */
  lastAnswer: string | null;
  /** For the integrator: the pull request body to use (criteria, evidence, review, risk). */
  pr: { body: string; url: string | null } | null;
  /** Where the full history is. */
  more: string;
}

const SUBMISSIONS = new Set<ConversationEntry["messageType"]>(["plan", "code", "review", "merge", "verify"]);

export function buildTaskBrief(taskOrId: Task | string): TaskBrief | null {
  const task = typeof taskOrId === "string" ? getTaskById(taskOrId) : taskOrId;
  if (!task) return null;
  const project = task.projectId ? getProjectById(task.projectId) : null;
  const profile = resolveProfile(project?.profile);
  const policy = resolvePolicy(project, task);

  const lastSubmission = task.conversation.map((e, i) => (SUBMISSIONS.has(e.messageType) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const humanNotes = task.conversation
    .slice(lastSubmission + 1)
    .filter((e) => e.messageType === "user")
    .map((e) => ({ author: e.authorName, at: e.timestamp, message: e.message }));

  const latestPlan = task.approvedPlan
    ? null
    : ([...task.conversation].reverse().find((e) => e.messageType === "plan")?.message ?? null);

  const guardrails = [...new Set([...profile.guardrails, ...task.guardrails].map((g) => g.trim()).filter(Boolean))];
  const used = reviewRoundsUsed(task);
  const evidence = task.verification ? getEvidence(task.id).filter((e) => e.round === task.verification!.round) : [];
  const failing = evidence
    .filter((e) => e.producedBy === "runner:verify" && !e.skipped && e.exitCode !== 0)
    .map((e) => ({ command: e.command, exitCode: e.exitCode, summary: e.summary }));
  const answer = [...task.conversation].reverse().find((e) => e.message.startsWith("**Blocker resolved**"));

  return {
    task: {
      id: task.id,
      title: task.title,
      type: task.type,
      risk: task.risk,
      status: task.status,
      description: task.description,
      steerDetails: task.steerDetails,
      nonGoals: task.nonGoals,
      references: task.references,
      recommendedBranch: task.recommendedBranch,
      realBranch: task.realBranch,
      mergeBranch: task.mergeBranch,
      worktreePath: task.worktreePath,
      headSha: task.headSha,
    },
    project: project
      ? { id: project.id, displayName: project.displayName, workingDirectory: project.workingDirectory }
      : null,
    typeGuidance: TASK_TYPES[task.type]?.guidance ?? "",
    guardrails,
    commands: profile.commands,
    criteria: task.acceptanceCriteria,
    approvedPlan: task.approvedPlan,
    latestPlan,
    openFindings: getFindings(task.id).filter((f) => f.status !== "verified"),
    handoffs: latestHandoffs(task.id),
    humanNotes,
    round: {
      planRound: task.planRound,
      codeRound: task.codeRound,
      reviewRoundsUsed: used,
      maxReviewRounds: policy.maxReviewRounds,
      remainingReviewRounds: Math.max(0, policy.maxReviewRounds - used),
    },
    verification: task.verification ? { ...task.verification, failing } : null,
    lastAnswer: answer ? answer.message.replace(/^\*\*Blocker resolved\*\*[^\n]*\n*/, "").trim() || null : null,
    pr:
      [TaskStatus.Approved, TaskStatus.Merging, TaskStatus.PrOpen].includes(task.status)
        ? { body: renderPrBody(task), url: task.pullRequest?.url ?? null }
        : null,
    more: "The full conversation, history and every piece of evidence: call get_task.",
  };
}

/** The phase whose handoff an agent in `phase` should read first. */
export function previousPhase(phase: Phase): Phase | null {
  const previous: Record<Phase, Phase | null> = {
    refine: null,
    plan: "refine",
    plan_review: "plan",
    code: "plan",
    verify: "code",
    review: "code",
    merge: "review",
  };
  return previous[phase];
}

const MARK = { met: "✅", failed: "❌", waived: "➖", pending: "⬜" } as const;

/**
 * The pull request body: what the task asked, how each criterion was verified,
 * what the AI review decided and what is risky — so the human review on GitHub
 * is the only one needed.
 */
export function renderPrBody(task: Task): string {
  const evidence = new Map(getEvidence(task.id).map((e) => [e.id, e]));
  const findings = getFindings(task.id);
  const resolved = findings.filter((f) => f.status !== "open");
  const lines: string[] = [];
  const summary = (task.description ?? "").split("\n\n")[0]?.trim();
  lines.push("## Summary", "", summary || task.title, "");
  if (task.acceptanceCriteria.length) {
    lines.push("## Acceptance criteria", "");
    for (const c of task.acceptanceCriteria) {
      const proof = c.evidenceIds
        .map((id) => evidence.get(id))
        .filter((e): e is Evidence => !!e && !e.skipped)
        .map((e) => (e.command ? `\`${e.command}\` ${e.exitCode === 0 ? "passed" : `exit ${e.exitCode}`}` : e.summary))
        .slice(-2);
      lines.push(`- ${MARK[c.status]} **${c.id}** ${c.text}${proof.length ? ` — ${proof.join("; ")}` : ""}`);
    }
    lines.push("");
  }
  const v = task.verification;
  lines.push("## Verification", "");
  if (!v) lines.push("Not verified by AgentQ.");
  else if (v.skipped) lines.push(v.note ?? "Not verified.");
  else {
    lines.push(`${v.passed ? "✅ Passed" : "❌ Failed"} (round ${v.round})${v.verifiedSha ? ` on \`${v.verifiedSha.slice(0, 12)}\`` : ""}.`);
    if (task.diffStats) lines.push(`Diff: ${task.diffStats.files} files, +${task.diffStats.insertions} −${task.diffStats.deletions}.`);
  }
  lines.push("");
  lines.push("## Review", "");
  if (task.lastReview) {
    lines.push(`AI review: **${task.lastReview.verdict}** in round ${task.lastReview.round} by \`${task.lastReview.by}\`.`);
  } else {
    lines.push("Reviewed by a person in AgentQ.");
  }
  if (resolved.length) {
    lines.push("", "Findings addressed:");
    for (const f of resolved) lines.push(`- ${f.id} (${f.severity}) ${f.status}${f.resolution ? ` — ${f.resolution}` : ""}`);
  }
  const open = findings.filter((f) => f.status === "open");
  if (open.length) {
    lines.push("", "Still open (non-blocking):");
    for (const f of open) lines.push(`- ${f.id} (${f.severity}) ${f.text}`);
  }
  lines.push("", "## Risk", "", `**${task.risk}**${task.riskReasons.length ? `: ${task.riskReasons.join("; ")}` : ""}`);
  if (task.nonGoals.length) lines.push("", "Out of scope: " + task.nonGoals.join("; "));
  lines.push("", `AgentQ task \`${task.id}\``);
  return lines.join("\n");
}
