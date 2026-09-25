/**
 * What an agent needs to continue a task, without rereading the whole
 * conversation: the approved plan and its validation, criteria with status,
 * open findings, the latest handoff of each phase, the project's commands,
 * the round, and what people said since the last submission.
 * Its size stays flat as rounds pile up; get_task still has everything.
 *
 * The phases that check another agent's work (plan critique, verification,
 * code review) get an independent brief instead: the task and what to check,
 * never the notes, messages or evidence of the agent whose work they check.
 */
import { getProjectById, getTaskById } from "./database.js";
import { STATUS_INFO, TASK_TYPES, TaskStatus, type Phase } from "./catalog.js";
import { getEvidence, getFindings, getHandoffs, latestHandoffs } from "./records.js";
import { resolveProfile, type ProjectCommands } from "./profile.js";
import { resolvePolicy, reviewRoundsUsed } from "./policy.js";
import type {
  AcceptanceCriterion,
  ApprovedPlan,
  ConversationEntry,
  Evidence,
  Finding,
  Handoff,
  PlanSubmission,
  Task,
  TaskReference,
  ValidationPlan,
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
  /** For the `pr` role: the pull request body to use (criteria, evidence, review, risk). */
  pr: { body: string; url: string | null } | null;
  /** Where the full history is. */
  more: string;
}

const SUBMISSIONS = new Set<ConversationEntry["messageType"]>(["plan", "code", "review", "merge", "verify"]);

/** What the task, its project and its round look like in every brief. */
function briefBasics(task: Task) {
  const project = task.projectId ? getProjectById(task.projectId) : null;
  const profile = resolveProfile(project?.profile);
  const policy = resolvePolicy(project, task);
  const used = reviewRoundsUsed(task);

  const lastSubmission = task.conversation.map((e, i) => (SUBMISSIONS.has(e.messageType) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const humanNotes = task.conversation
    .slice(lastSubmission + 1)
    .filter((e) => e.messageType === "user")
    .map((e) => ({ author: e.authorName, at: e.timestamp, message: e.message }));

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
    guardrails: [...new Set([...profile.guardrails, ...task.guardrails].map((g) => g.trim()).filter(Boolean))],
    commands: profile.commands,
    humanNotes,
    round: {
      planRound: task.planRound,
      codeRound: task.codeRound,
      reviewRoundsUsed: used,
      maxReviewRounds: policy.maxReviewRounds,
      remainingReviewRounds: Math.max(0, policy.maxReviewRounds - used),
    },
  };
}

/** The latest verification, with the commands the verifier saw fail. */
function verificationOf(task: Task): TaskBrief["verification"] {
  if (!task.verification) return null;
  const failing = getEvidence(task.id)
    .filter((e) => e.round === task.verification!.round)
    .filter((e) => e.producedBy === "runner:verify" && !e.skipped && e.exitCode !== 0)
    .map((e) => ({ command: e.command, exitCode: e.exitCode, summary: e.summary }));
  return { ...task.verification, failing };
}

function latestPlanOf(task: Task): string | null {
  return [...task.conversation].reverse().find((e) => e.messageType === "plan")?.message ?? null;
}

export function buildTaskBrief(taskOrId: Task | string): TaskBrief | null {
  const task = typeof taskOrId === "string" ? getTaskById(taskOrId) : taskOrId;
  if (!task) return null;
  const { humanNotes, round, ...basics } = briefBasics(task);
  const answer = [...task.conversation].reverse().find((e) => e.message.startsWith("**Blocker resolved**"));

  return {
    ...basics,
    criteria: task.acceptanceCriteria,
    approvedPlan: task.approvedPlan,
    latestPlan: task.approvedPlan ? null : latestPlanOf(task),
    openFindings: getFindings(task.id).filter((f) => f.status !== "verified"),
    handoffs: latestHandoffs(task.id),
    humanNotes,
    round,
    verification: verificationOf(task),
    lastAnswer: answer ? answer.message.replace(/^\*\*Blocker resolved\*\*[^\n]*\n*/, "").trim() || null : null,
    pr:
      [TaskStatus.Approved, TaskStatus.Merging, TaskStatus.PrOpen].includes(task.status)
        ? { body: renderPrBody(task), url: task.pullRequest?.url ?? null }
        : null,
    more: "The full conversation, history and every piece of evidence: call get_task.",
  };
}

// ─── Independent checks ───────────────────────────────────────────────

/**
 * Phases that check another agent's work: the plan critique, the verification
 * and the code review. Their agent starts clean, from an independent brief.
 */
export const INDEPENDENT_PHASES = ["plan_review", "verify", "review"] as const satisfies readonly Phase[];
export type IndependentPhase = (typeof INDEPENDENT_PHASES)[number];

export function isIndependentPhase(phase: Phase | null | undefined): phase is IndependentPhase {
  return INDEPENDENT_PHASES.includes(phase as IndependentPhase);
}

/** An earlier finding the checker verifies by id. */
export interface FindingToVerify {
  id: string;
  round: number;
  severity: Finding["severity"];
  file: string | null;
  line: number | null;
  text: string;
  /** `open`: not answered yet; `fixed` / `wontfix`: what the author says it did (check it in the work). */
  status: Finding["status"];
  /** Why the author declined to fix it (`wontfix` only): a claim to judge, not a fact. */
  wontfixReason?: string;
}

/**
 * What the agent of a phase that checks another agent's work gets: the task,
 * what to check and the findings to verify. It leaves out the conversation,
 * the handoff notes, the messages and the evidence of the agent whose work it
 * checks, and that agent's own view of the criteria: the check judges the
 * work itself, not its author's account of it.
 */
export interface IndependentBrief {
  independent: true;
  phase: IndependentPhase;
  task: TaskBrief["task"];
  project: TaskBrief["project"];
  typeGuidance: string;
  guardrails: string[];
  commands: ProjectCommands;
  /** What must hold and how each one is checked, without anyone's claim that it does. */
  criteria: Pick<AcceptanceCriterion, "id" | "text" | "verify">[];
  /** The plan the code must follow (review and verify). */
  approvedPlan: ApprovedPlan | null;
  /** The plan under critique (plan review only). */
  latestPlan: string | null;
  /** How the plan under critique verifies each criterion (plan review only). */
  validationPlan: ValidationPlan | null;
  /** What the planner declared with the plan: open questions, risk, subtasks, paths (plan review only). */
  planSubmission: PlanSubmission | null;
  /** Earlier findings of this phase not yet verified (plan review and review). */
  openFindings: FindingToVerify[];
  /** What people decided along the way (answers to blockers, change requests), oldest first. */
  humanDecisions: { at: string; decision: string }[];
  /** What people wrote since the last agent submission. */
  humanNotes: TaskBrief["humanNotes"];
  /** The verifier's result on the submitted commit (review only). */
  verification: TaskBrief["verification"];
  round: TaskBrief["round"];
  /** What this brief leaves out, and how to check the work instead. */
  isolation: string;
}

const GET_TASK_NOTE = "While you hold the task, get_task returns this same brief.";

function isolationNote(phase: IndependentPhase, task: Task): string {
  switch (phase) {
    case "plan_review":
      return `Independent critique: this brief leaves out the planner's handoff notes and the task's conversation on purpose. Judge the plan by itself against the task, its criteria and the code. ${GET_TASK_NOTE}`;
    case "verify":
      return `Independent verification: this brief leaves out the coder's notes, messages and evidence on purpose. Run the commands yourself in task.worktreePath and trust only their output. ${GET_TASK_NOTE}`;
    case "review":
      return `Independent review: this brief leaves out the coder's notes, messages and evidence and the earlier handoffs on purpose. Judge the code from the diff (\`git diff ${task.mergeBranch}...HEAD\` in task.worktreePath), the task, the criteria and the guardrails, not from its author's account of it. ${GET_TASK_NOTE}`;
  }
}

/** The independent brief for checking the task's work in `phase` (see IndependentBrief). */
export function buildIndependentBrief(taskOrId: Task | string, phase: IndependentPhase): IndependentBrief | null {
  const task = typeof taskOrId === "string" ? getTaskById(taskOrId) : taskOrId;
  if (!task) return null;
  const critique = phase === "plan_review";
  const findingPhase = critique ? "plan" : phase === "review" ? "code" : null;
  const openFindings = findingPhase
    ? getFindings(task.id, { phase: findingPhase, status: ["open", "fixed", "wontfix"] }).map((f) => ({
        id: f.id,
        round: f.round,
        severity: f.severity,
        file: f.file,
        line: f.line,
        text: f.text,
        status: f.status,
        ...(f.status === "wontfix" && f.resolution ? { wontfixReason: f.resolution } : {}),
      }))
    : [];

  return {
    independent: true,
    phase,
    ...briefBasics(task),
    criteria: task.acceptanceCriteria.map(({ id, text, verify }) => ({ id, text, verify })),
    approvedPlan: critique ? null : task.approvedPlan,
    latestPlan: critique ? latestPlanOf(task) : null,
    validationPlan: critique ? task.validationPlan : null,
    planSubmission: critique ? task.planSubmission : null,
    openFindings,
    humanDecisions: getHandoffs(task.id)
      .filter((h) => h.phase === "human")
      .map((h) => ({ at: h.createdAt, decision: h.summary })),
    verification: phase === "review" ? verificationOf(task) : null,
    isolation: isolationNote(phase, task),
  };
}

/**
 * The brief for the agent of the task's current phase: independent for the
 * phases that check another agent's work, the full one otherwise.
 */
export function buildAgentBrief(taskOrId: Task | string): TaskBrief | IndependentBrief | null {
  const task = typeof taskOrId === "string" ? getTaskById(taskOrId) : taskOrId;
  if (!task) return null;
  const phase = STATUS_INFO[task.status]?.phase;
  return isIndependentPhase(phase) ? buildIndependentBrief(task, phase) : buildTaskBrief(task);
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
