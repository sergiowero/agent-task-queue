/**
 * What an agent needs to continue a task, without rereading the whole
 * conversation: the approved plan and its validation, criteria with status,
 * open findings, the latest handoff of each phase, the project's commands and
 * conventions, the round, and what people said since the last submission.
 * Its size stays flat as rounds pile up; get_task still has everything.
 */
import { getProjectById, getTaskById } from "./database.js";
import { TASK_TYPES, type Phase } from "./catalog.js";
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
  conventionFiles: string[];
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
    conventionFiles: profile.conventionFiles,
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
    more: "The full conversation, history and every piece of evidence: call get_task.",
  };
}

/** The phase whose handoff an agent in `phase` should read first. */
export function previousPhase(phase: Phase): Phase | null {
  return ({ plan: null, code: "plan", verify: "code", review: "code", merge: "review" } as const)[phase];
}
