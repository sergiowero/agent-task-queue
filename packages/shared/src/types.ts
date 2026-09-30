import type {
  AutonomyLevel,
  FindingStatus,
  Phase,
  Risk,
  Role,
  Severity,
  TaskStatus,
  TaskType,
  Verdict,
} from "./catalog.js";
import type { PolicySettings } from "./policy.js";
import type { AcceptanceCriterion } from "./criteria.js";
import type { ProjectProfile } from "./profile.js";

export type { AcceptanceCriterion } from "./criteria.js";
export type { ProjectProfile, ProjectCommands } from "./profile.js";

export { TaskStatus, normalizeStatus } from "./catalog.js";

export interface ConversationEntry {
  authorName: string;
  timestamp: string;
  message: string;
  /** refine: a refinement; plan_review: a plan critique; review: a code review. */
  messageType?: "user" | "agent" | "refine" | "plan" | "plan_review" | "code" | "verify" | "review" | "merge" | "system";
}

export interface StatusHistoryEntry {
  pre_status: string;
  new_status: string;
  timestamp: string;
  /** Who made the change: "user", an agent id, "runner" or "system". Absent on old entries. */
  actor?: string;
}

export interface AgentReference {
  name: string;
  tool: string;
  model: string;
  /** Agent row id (`tool@version|model`) of the claim. */
  agentId?: string;
  /**
   * Primary identity used for separation of duties: `runner:<runnerId>` for
   * runner claims, `session:<tool>:<sessionId>` for agents that claimed through
   * MCP (`mcp:<instance>` when their sessionId is a placeholder).
   */
  sessionKey?: string;
  /**
   * Every identity of the claim, `sessionKey` first. An MCP claim also carries
   * `mcp:<instance>`, the server process it came through.
   */
  identities?: string[];
  /** The claim's model as `requireDifferentModel` compares it (see modelKey). */
  modelKey?: string;
  runnerId?: string;
  claimedAt?: string;
}

/** Who produced a phase's artifact (plan, code, review, merge): used for separation of duties. */
export interface Producer {
  /** Identity of the latest producer. */
  sessionKey: string | null;
  /** Identities of every producer of the phase, across rounds (absent on old tasks). */
  identities?: string[];
  agentId: string | null;
  tool: string | null;
  model: string | null;
  /** Model keys of every producer of the phase, across rounds (absent on old tasks). */
  modelKeys?: string[];
  at: string;
}

export interface LastReview {
  round: number;
  verdict: Verdict;
  by: string;
  at: string;
  /** The commit the reviewer looked at (absent on old reviews). */
  sha?: string | null;
  /** The code was submitted again since: this verdict is about an earlier submission. */
  stale?: boolean;
}

/**
 * The approval that sent the code to the pull request: who approved it and
 * which commit. The PR and the L3 auto-merge ship only this commit.
 */
export interface Approval {
  /** The approved commit; null when neither the worktree nor the submission named one. */
  sha: string | null;
  /** The AI reviewer's agent id, or the person who approved ("user"). */
  by: string;
  /** A person approved (on the task page, or answering a blocker), not the AI reviewer. */
  human: boolean;
  /** AI code reviews so far when it was approved (task.codeRound). */
  round: number;
  at: string;
}

/** A review finding, tracked by id across rounds ("R2-3" = code review round 2, finding 3). */
export interface Finding {
  id: string;
  taskId: string;
  round: number;
  phase: "plan" | "code";
  severity: Severity;
  file: string | null;
  line: number | null;
  text: string;
  status: FindingStatus;
  resolution: string | null;
  raisedBy: string;
  /** Times a reviewer reopened it after the coder marked it fixed or wontfix. */
  reopenCount: number;
  createdAt: string;
  updatedAt: string;
}

/** How the plan says each acceptance criterion will be verified. */
export interface ValidationPlan {
  items: { criterionId: string; how: string; command?: string; newTests?: string[] }[];
  /** Commands that must keep passing (e.g. "bun test", "bun run typecheck"). */
  regressionCommands: string[];
}

export interface ApprovedPlan {
  markdown: string;
  validation: ValidationPlan | null;
  /** "user" when a person approved it, else the critic's agent id. */
  approvedBy: string;
  at: string;
}

/** One piece of evidence: a command run (by the coder or the verifier) or a manual check. */
export interface Evidence {
  id: string;
  taskId: string;
  round: number;
  kind: "command" | "manual";
  criterionId: string | null;
  command: string | null;
  exitCode: number | null;
  /** The relevant lines of output, not the whole log. */
  summary: string;
  logPath: string | null;
  /** Agent id, or "runner:verify" for the built-in verifier. */
  producedBy: string;
  flaky: boolean;
  skipped: boolean;
  createdAt: string;
}

/** A commit the task's work went through: one per code submission, verification and pull request. */
export interface CommitRecord {
  /** The code round it belongs to (the round its code submission is reviewed in). */
  round: number;
  /** code: the coder submitted it · verify: the verifier checked it · pr: the pull request's head. */
  phase: "code" | "verify" | "pr";
  sha: string;
  branch: string | null;
  at: string;
}

export interface DiffStats {
  files: number;
  insertions: number;
  deletions: number;
}

/** Outcome of the latest verification of the submitted code. */
export interface Verification {
  round: number;
  passed: boolean;
  skipped: boolean;
  /** Why it was skipped, or the infrastructure problem that stopped it. */
  note: string | null;
  tampering: string[];
  /** Verifications (so far) that found test tampering; a person's answer resets them. */
  tamperStrikes: number;
  /** Test changes a person ruled legitimate: later checks of the (cumulative) diff do not flag them again. */
  acceptedTampering?: string[];
  verifiedSha: string | null;
  at: string;
  /** The evidence this verification recorded (older records have none: their round's evidence is used). */
  evidenceIds?: string[];
}

/** What the planner said beyond the plan text. */
export interface PlanSubmission {
  openQuestions: { text: string; blocking: boolean }[];
  suggestedRisk: Risk | null;
  /** Subtasks the planner proposes (created with create_subtask). */
  proposedSubtasks: string[];
  /** Paths the plan expects to touch (protected ones raise the risk). */
  touchedPaths: string[];
}

/** The pull request the agent with the `pr` role opened, kept in sync with GitHub. */
export interface PullRequest {
  url: string | null;
  number: number | null;
  state: "open" | "merged" | "closed";
  /** Head branch, used to find the PR when the URL is unknown. */
  branch: string | null;
  /** Base branch submit_pr named (absent on old tasks). */
  base?: string | null;
  /** Who wrote the code, as submit_pr named them (absent on old tasks). */
  authors?: string | null;
  mergedAt: string | null;
  mergedBy: string | null;
  /** The PR's head commit: what submit_pr pushed, then what GitHub reports (absent on old tasks). */
  headSha?: string | null;
  /** GitHub users whose latest review asks for changes (it holds back the L3 auto-merge). */
  changesRequestedBy: string[];
  /**
   * Everyone who asked for changes on the task's PR at any point, even if they
   * approved later (for the "human rejection after AI approval" metric). Absent on old tasks.
   */
  changesEverRequestedBy?: string[];
  checks: "pending" | "success" | "failure" | null;
  checkedAt: string | null;
}

/** Notes one phase leaves for the next (what was decided, what is risky, what to do next). */
export interface Handoff {
  id: number;
  taskId: string;
  /** Phase that wrote it; "human" for a person's answer or change request, "legacy" for old contexts. */
  phase: Phase | "human" | "claim" | "legacy";
  round: number;
  agentId: string;
  summary: string;
  decisions: string[];
  risks: string[];
  next: string[];
  createdAt: string;
}

export interface TaskReference {
  label: string;
  /** URL, file path or issue id. */
  target: string;
}

/** Why an agent (or the runner) stopped and what it needs from a person. */
export interface Blocker {
  reason: string;
  question: string;
  /** Phase the task was blocked in; decides where a person may send it next. */
  phase: Phase | null;
  /** Status the task was in when it was blocked. */
  fromStatus: TaskStatus;
  raisedBy: string;
  at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  steerDetails: string | null;
  guardrails: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  priority: number;
  recommendedBranch: string;
  realBranch: string | null;
  requiresPlan: boolean;
  mergeBranch: string;
  status: TaskStatus;
  assignedAgent: AgentReference | null;
  conversation: ConversationEntry[];
  history: StatusHistoryEntry[];
  contexts: string[];
  projectId: string | null;
  worktreePath: string | null;
  /**
   * Secret handed to the agent that holds the claim; submits must present it.
   * Null when nobody holds the task (and on claims made before it existed).
   */
  claimToken: string | null;
  /** Set while the task is in `needs_human`. */
  blocker: Blocker | null;
  /** Consecutive runs that ended without a submit; reset by any submit or human action. */
  revertStreak: number;
  type: TaskType;
  risk: Risk;
  /** Overrides the project's autonomy level; null uses the project's. */
  autonomy: AutonomyLevel | null;
  /** Plan critiques so far. */
  planRound: number;
  /** AI code reviews so far (finding ids use it: R{codeRound}-n). */
  codeRound: number;
  /** Consecutive red verifications. */
  verifyFailures: number;
  /** Round counts at the last time a person reset the limits (answering an escalation). */
  roundBaseline: { plan?: number; code?: number };
  /** Who produced each phase's latest artifact. */
  producers: Partial<Record<Phase, Producer>>;
  /** Hand-opened agent sessions must show activity before this time or lose the claim. */
  leaseExpiresAt: string | null;
  lastReview: LastReview | null;
  /** Who approved the code for the pull request, and which commit (null until approved). */
  approval: Approval | null;
  /** The latest plan's validation plan (proposed; approvedPlan holds the approved one). */
  validationPlan: ValidationPlan | null;
  /** Frozen when the plan is approved; the coder may not change it. */
  approvedPlan: ApprovedPlan | null;
  /** The latest submitted commit: the worktree's HEAD when the server can read it, else what the agent said. */
  headSha: string | null;
  /** Every commit recorded along the way, oldest first (code submissions, verifications, the PR). */
  commits: CommitRecord[];
  diffStats: DiffStats | null;
  verification: Verification | null;
  /** Why the risk was raised (touched protected paths, a large diff, the plan). */
  riskReasons: string[];
  /** What the task deliberately does not do. */
  nonGoals: string[];
  /** Files, issues and links to look at first. */
  references: TaskReference[];
  /** Definition-of-Ready problems found when the task was created or edited. */
  dorIssues: string[];
  /** The task this one was split from. */
  parentId: string | null;
  /** Tasks that must be complete before this one can be claimed. */
  blockedBy: string[];
  planSubmission: PlanSubmission | null;
  /** A subtask waiting for its parent's plan to be approved. */
  held: boolean;
  pullRequest: PullRequest | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Set once the task was written to the project's archive/ folder; archived tasks leave the board. */
  archivedAt: string | null;
  /** Absolute path of the archive summary file (the detailed file sits next to it). */
  archivePath: string | null;
}

export interface Agent {
  id: string;
  toolName: string;
  version: string;
  model: string;
  /** The role its latest claim acted as (e.g. "code"). */
  role: string;
  sessionId: string;
  host: string | null;
  startedAt: string | null;
  lastSeen: string | null;
  deletedAt: string | null;
}

export interface Project {
  id: string;
  displayName: string;
  workingDirectory: string;
  /** Branch new tasks merge into (detected from origin/HEAD when the project is created). */
  defaultMergeBranch: string | null;
  autonomy: AutonomyLevel;
  /** Overrides of the default policy settings. */
  policy: Partial<PolicySettings>;
  /** Commands, protected paths and shared guardrails. */
  profile: ProjectProfile;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ActivityEvent {
  id: number;
  eventType: string;
  taskId: string;
  actor: string | null;
  details: string | null;
  createdAt: string;
}

export type RunnerTool = "claude" | "codex" | "opencode" | "gemini" | "custom";
export type RunnerPermissionMode = "safe" | "full";

export interface Runner {
  id: string;
  name: string;
  tool: RunnerTool;
  /** The phases it works (one or more). */
  roles: Role[];
  projectId: string | null;
  model: string | null;
  /** Reasoning effort passed to tools that support it (claude, codex, opencode). */
  effort: string | null;
  concurrency: number;
  pollIntervalSec: number;
  permissionMode: RunnerPermissionMode;
  extraArgs: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
