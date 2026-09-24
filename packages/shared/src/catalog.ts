/**
 * The task state machine as data: statuses, what each one means, which role
 * claims which status, and the edges a task may take. Pure module (no Bun, Node
 * or database imports) so the web UI can import it as `@agentq/shared/catalog`.
 */

export enum TaskStatus {
  PlanRequested = "plan_requested",
  Planning = "planning",
  WaitingPlanReview = "waiting_plan_review",
  PlanChangesRequested = "plan_changes_requested",
  ReadyForCode = "ready_for_code",
  Coding = "coding",
  WaitingCodeReview = "waiting_code_review",
  CodeReviewRequested = "code_review_requested",
  Reviewing = "reviewing",
  ChangesRequested = "changes_requested",
  Approved = "approved",
  Merging = "merging",
  /** A pull request is open; the task completes when it is merged (replaces the old "merged"). */
  PrOpen = "pr_open",
  Complete = "complete",
  Canceled = "canceled",
  NeedsHuman = "needs_human",
  VerifyRequested = "verify_requested",
  Verifying = "verifying",
  PlanReviewRequested = "plan_review_requested",
  PlanReviewing = "plan_reviewing",
  Draft = "draft",
  Refining = "refining",
  Split = "split",
}

export function normalizeStatus(status: string): TaskStatus {
  if (status === "ready for code") return TaskStatus.ReadyForCode;
  // "merged" only ever meant "the PR is open".
  if (status === "merged") return TaskStatus.PrOpen;
  return status as TaskStatus;
}

/** Work phases; each has a skill (`skills/agentq-<phase>`) and a submit tool. */
export type Phase = "refine" | "plan" | "plan_review" | "code" | "verify" | "review" | "merge";

/**
 * queued: waiting for an agent to claim it · active: an agent holds it ·
 * human: waiting for a person · waiting: waiting for other tasks (subtasks) ·
 * done / terminal: finished.
 */
export type StatusKind = "queued" | "active" | "human" | "waiting" | "done" | "terminal";

export type BoardColumn = "pending" | "in-progress" | "need-review" | "done";

export interface StatusInfo {
  label: string;
  kind: StatusKind;
  /** Phase the status belongs to (null for done/terminal statuses). */
  phase: Phase | null;
  /** Board column; null keeps the task off the board (canceled). */
  boardColumn: BoardColumn | null;
  /** A person may cancel the task from here. */
  cancelable: boolean;
  /** A person may edit the task's text fields from here. */
  editable: boolean;
  /** One line telling a person what the status waits for. */
  hint: string;
}

export const STATUS_INFO: Record<TaskStatus, StatusInfo> = {
  [TaskStatus.PlanRequested]: {
    label: "Plan requested",
    kind: "queued",
    phase: "plan",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "Waiting for a planner agent to pick it up.",
  },
  [TaskStatus.Planning]: {
    label: "Planning",
    kind: "active",
    phase: "plan",
    boardColumn: "in-progress",
    cancelable: true,
    editable: false,
    hint: "A planner agent is writing the plan.",
  },
  [TaskStatus.WaitingPlanReview]: {
    label: "Plan review",
    kind: "human",
    phase: "plan",
    boardColumn: "need-review",
    cancelable: true,
    editable: true,
    hint: "Read the plan, then approve it or ask for changes.",
  },
  [TaskStatus.PlanChangesRequested]: {
    label: "Plan changes requested",
    kind: "queued",
    phase: "plan",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "Waiting for a planner agent to revise the plan.",
  },
  [TaskStatus.ReadyForCode]: {
    label: "Ready for code",
    kind: "queued",
    phase: "code",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "Waiting for an implementer agent to pick it up.",
  },
  [TaskStatus.Coding]: {
    label: "Coding",
    kind: "active",
    phase: "code",
    boardColumn: "in-progress",
    cancelable: true,
    editable: false,
    hint: "An implementer agent is writing the code.",
  },
  [TaskStatus.WaitingCodeReview]: {
    label: "Code review",
    kind: "human",
    phase: "code",
    boardColumn: "need-review",
    cancelable: true,
    editable: true,
    hint: "Review the code, then approve it, ask for changes or request an AI review.",
  },
  [TaskStatus.CodeReviewRequested]: {
    label: "AI review requested",
    kind: "queued",
    phase: "review",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "Waiting for a reviewer agent to pick it up.",
  },
  [TaskStatus.Reviewing]: {
    label: "Reviewing",
    kind: "active",
    phase: "review",
    boardColumn: "in-progress",
    cancelable: true,
    editable: false,
    hint: "A reviewer agent is reviewing the code.",
  },
  [TaskStatus.ChangesRequested]: {
    label: "Changes requested",
    kind: "queued",
    phase: "code",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "Waiting for an implementer agent to address the feedback.",
  },
  [TaskStatus.Approved]: {
    label: "Approved",
    kind: "queued",
    phase: "merge",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "Waiting for an agent to push the branch and open the pull request.",
  },
  [TaskStatus.Merging]: {
    label: "Merging",
    kind: "active",
    phase: "merge",
    boardColumn: "in-progress",
    cancelable: true,
    editable: false,
    hint: "An agent is pushing the branch and opening the pull request.",
  },
  [TaskStatus.PrOpen]: {
    label: "PR open",
    kind: "human",
    phase: "merge",
    boardColumn: "need-review",
    cancelable: true,
    editable: false,
    hint: "The pull request is open: review and merge it on GitHub. AgentQ completes the task when it sees the merge.",
  },
  [TaskStatus.Complete]: {
    label: "Complete",
    kind: "done",
    phase: null,
    boardColumn: "done",
    cancelable: false,
    editable: false,
    hint: "Done.",
  },
  [TaskStatus.Canceled]: {
    label: "Canceled",
    kind: "terminal",
    phase: null,
    boardColumn: null,
    cancelable: false,
    editable: false,
    hint: "Canceled.",
  },
  [TaskStatus.VerifyRequested]: {
    label: "Verify requested",
    kind: "queued",
    phase: "verify",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "Waiting for the verifier to run the project's commands on the submitted code.",
  },
  [TaskStatus.Verifying]: {
    label: "Verifying",
    kind: "active",
    phase: "verify",
    boardColumn: "in-progress",
    cancelable: true,
    editable: false,
    hint: "The verifier is running the project's commands in the task's worktree.",
  },
  [TaskStatus.PlanReviewRequested]: {
    label: "Plan critique requested",
    kind: "queued",
    phase: "plan_review",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "Waiting for a plan-reviewer agent (another model) to critique the plan.",
  },
  [TaskStatus.PlanReviewing]: {
    label: "Plan critique",
    kind: "active",
    phase: "plan_review",
    boardColumn: "in-progress",
    cancelable: true,
    editable: false,
    hint: "A plan-reviewer agent is critiquing the plan.",
  },
  [TaskStatus.Draft]: {
    label: "Draft",
    kind: "queued",
    phase: "refine",
    boardColumn: "pending",
    cancelable: true,
    editable: true,
    hint: "A rough task: a refiner agent makes it ready (criteria, risk, questions), or promote it yourself.",
  },
  [TaskStatus.Refining]: {
    label: "Refining",
    kind: "active",
    phase: "refine",
    boardColumn: "in-progress",
    cancelable: true,
    editable: false,
    hint: "A refiner agent is turning the draft into a ready task.",
  },
  [TaskStatus.Split]: {
    label: "Split into subtasks",
    kind: "waiting",
    phase: null,
    boardColumn: "in-progress",
    cancelable: true,
    editable: true,
    hint: "The work continues in its subtasks; this task completes when they all do.",
  },
  [TaskStatus.NeedsHuman]: {
    label: "Needs you",
    kind: "human",
    phase: null,
    boardColumn: "need-review",
    cancelable: true,
    editable: true,
    hint: "An agent is blocked. Answer its question and choose where the task goes next.",
  },
};

export const ALL_STATUSES = Object.values(TaskStatus) as TaskStatus[];

/** The skill that covers a phase: skills/agentq-<phase with dashes>/SKILL.md. */
export function skillForPhase(phase: Phase): string {
  if (phase === "merge") return "agentq-pr";
  return `agentq-${phase.replace(/_/g, "-")}`;
}

export function statusLabel(status: string): string {
  return STATUS_INFO[status as TaskStatus]?.label ?? status.replace(/_/g, " ");
}

export function isActiveStatus(status: string): boolean {
  return STATUS_INFO[status as TaskStatus]?.kind === "active";
}

// ─── Roles and claims ─────────────────────────────────────────────────

export interface ClaimRule {
  role: string;
  from: TaskStatus[];
  to: TaskStatus;
}

/** What each base role claims, and the active status the claim moves the task to. */
export const CLAIM_RULES: ClaimRule[] = [
  { role: "refiner", from: [TaskStatus.Draft], to: TaskStatus.Refining },
  {
    role: "planner",
    from: [TaskStatus.PlanRequested, TaskStatus.PlanChangesRequested],
    to: TaskStatus.Planning,
  },
  { role: "plan_reviewer", from: [TaskStatus.PlanReviewRequested], to: TaskStatus.PlanReviewing },
  {
    role: "implementer",
    from: [TaskStatus.ReadyForCode, TaskStatus.ChangesRequested],
    to: TaskStatus.Coding,
  },
  // The server's built-in verifier (no LLM) claims these too.
  { role: "verifier", from: [TaskStatus.VerifyRequested], to: TaskStatus.Verifying },
  { role: "reviewer", from: [TaskStatus.CodeReviewRequested], to: TaskStatus.Reviewing },
  { role: "integrator", from: [TaskStatus.Approved], to: TaskStatus.Merging },
];

export const BASE_ROLES = [
  "refiner",
  "planner",
  "plan_reviewer",
  "implementer",
  "verifier",
  "reviewer",
  "integrator",
] as const;

export const COMPOUND_ROLES: Record<string, string[]> = {
  // The built-in verifier covers verification, so senior agents do not claim it.
  senior: ["refiner", "planner", "plan_reviewer", "implementer", "reviewer", "integrator"],
  architect: ["planner", "plan_reviewer", "reviewer"],
  qa: ["verifier", "reviewer"],
  builder: ["implementer", "integrator"],
};

/** Every role an agent or runner may use. */
export const ROLES = [
  "planner",
  "plan_reviewer",
  "implementer",
  "reviewer",
  "integrator",
  "verifier",
  "refiner",
  "senior",
  "architect",
  "qa",
  "builder",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, string> = {
  planner: "Writes implementation plans with a validation plan",
  plan_reviewer: "Critiques plans (use a different model than the planner)",
  implementer: "Writes the code and tests, with evidence",
  reviewer: "Reviews code with a verdict (use a different model than the coder)",
  integrator: "Pushes the branch and opens the pull request",
  verifier: "Runs the verification commands (the server has a built-in one)",
  refiner: "Turns rough drafts into ready tasks",
  senior: "Everything except verification (for a single agent)",
  architect: "Plans, critiques plans and reviews code; never writes code",
  qa: "Verifies and reviews",
  builder: "Implements and integrates (opens the PR)",
};

/** Base roles a (possibly compound) role stands for. */
export function baseRolesOf(role: string): string[] {
  if (COMPOUND_ROLES[role]) return COMPOUND_ROLES[role];
  return CLAIM_RULES.some((r) => r.role === role) ? [role] : [];
}

/** Active status → the statuses a claim into it may come from. */
export const CLAIMABLE_FROM: Partial<Record<TaskStatus, TaskStatus[]>> = CLAIM_RULES.reduce(
  (acc, rule) => {
    acc[rule.to] = [...(acc[rule.to] ?? []), ...rule.from];
    return acc;
  },
  {} as Partial<Record<TaskStatus, TaskStatus[]>>,
);

/** Where a revert lands when history does not name a valid origin. */
export const REVERT_FALLBACK: Partial<Record<TaskStatus, TaskStatus>> = {
  [TaskStatus.Planning]: TaskStatus.PlanRequested,
  [TaskStatus.Coding]: TaskStatus.ReadyForCode,
  [TaskStatus.Reviewing]: TaskStatus.CodeReviewRequested,
  [TaskStatus.Merging]: TaskStatus.Approved,
  [TaskStatus.Verifying]: TaskStatus.VerifyRequested,
  [TaskStatus.PlanReviewing]: TaskStatus.PlanReviewRequested,
  [TaskStatus.Refining]: TaskStatus.Draft,
};

/** Where a person's "Unblock" sends an active task (the agent is dropped). */
export const UNBLOCK_TARGET: Partial<Record<TaskStatus, TaskStatus>> = {
  [TaskStatus.Planning]: TaskStatus.PlanChangesRequested,
  [TaskStatus.Coding]: TaskStatus.ChangesRequested,
  [TaskStatus.Reviewing]: TaskStatus.CodeReviewRequested,
  [TaskStatus.Merging]: TaskStatus.Approved,
  [TaskStatus.Verifying]: TaskStatus.VerifyRequested,
  [TaskStatus.PlanReviewing]: TaskStatus.PlanReviewRequested,
  [TaskStatus.Refining]: TaskStatus.Draft,
};

/** Statuses a person may send a `needs_human` task to, by the phase it was blocked in. */
export const RESOLVE_TARGETS: Record<Phase, TaskStatus[]> = {
  refine: [TaskStatus.Draft, TaskStatus.PlanRequested, TaskStatus.ReadyForCode, TaskStatus.Canceled],
  plan_review: [
    TaskStatus.PlanReviewRequested,
    TaskStatus.PlanChangesRequested,
    TaskStatus.WaitingPlanReview,
    TaskStatus.ReadyForCode,
    TaskStatus.Canceled,
  ],
  plan: [
    TaskStatus.PlanChangesRequested,
    TaskStatus.PlanRequested,
    TaskStatus.WaitingPlanReview,
    TaskStatus.ReadyForCode,
    TaskStatus.Canceled,
  ],
  code: [
    TaskStatus.ChangesRequested,
    TaskStatus.ReadyForCode,
    TaskStatus.WaitingCodeReview,
    TaskStatus.Canceled,
  ],
  verify: [
    TaskStatus.VerifyRequested,
    TaskStatus.ChangesRequested,
    TaskStatus.WaitingCodeReview,
    TaskStatus.CodeReviewRequested,
    TaskStatus.Canceled,
  ],
  review: [
    TaskStatus.CodeReviewRequested,
    TaskStatus.WaitingCodeReview,
    TaskStatus.ChangesRequested,
    TaskStatus.Approved,
    TaskStatus.Canceled,
  ],
  merge: [TaskStatus.Approved, TaskStatus.PrOpen, TaskStatus.Complete, TaskStatus.Canceled],
};

export function resolveTargets(phase: Phase | null | undefined): TaskStatus[] {
  if (phase) return RESOLVE_TARGETS[phase];
  return [...new Set(Object.values(RESOLVE_TARGETS).flat())];
}

/** Every edge a task may take (claims, submits, human actions, reverts, escalations). */
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = (() => {
  const t: Record<TaskStatus, Set<TaskStatus>> = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, new Set<TaskStatus>()]),
  ) as Record<TaskStatus, Set<TaskStatus>>;
  const add = (from: TaskStatus, ...to: TaskStatus[]) => to.forEach((s) => t[from].add(s));

  for (const rule of CLAIM_RULES) for (const from of rule.from) add(from, rule.to);
  for (const [active, origins] of Object.entries(CLAIMABLE_FROM)) {
    add(active as TaskStatus, ...(origins ?? []), REVERT_FALLBACK[active as TaskStatus]!);
  }
  for (const [active, target] of Object.entries(UNBLOCK_TARGET)) add(active as TaskStatus, target!);
  // Submissions (where each one lands is decided by the autonomy policy).
  add(TaskStatus.Planning, TaskStatus.WaitingPlanReview, TaskStatus.PlanReviewRequested, TaskStatus.ReadyForCode, TaskStatus.Split);
  add(
    TaskStatus.PlanReviewing,
    TaskStatus.ReadyForCode,
    TaskStatus.WaitingPlanReview,
    TaskStatus.PlanChangesRequested,
    TaskStatus.Split,
  );
  add(TaskStatus.Refining, TaskStatus.PlanRequested, TaskStatus.ReadyForCode);
  add(TaskStatus.Draft, TaskStatus.PlanRequested, TaskStatus.ReadyForCode);
  add(TaskStatus.PlanReviewRequested, TaskStatus.WaitingPlanReview);
  add(TaskStatus.Split, TaskStatus.Complete);
  add(
    TaskStatus.Coding,
    TaskStatus.WaitingCodeReview,
    TaskStatus.CodeReviewRequested,
    TaskStatus.VerifyRequested,
  );
  add(
    TaskStatus.Verifying,
    TaskStatus.CodeReviewRequested,
    TaskStatus.WaitingCodeReview,
    TaskStatus.ChangesRequested,
  );
  // The verifier went away: the review goes ahead without verification.
  add(TaskStatus.VerifyRequested, TaskStatus.CodeReviewRequested, TaskStatus.WaitingCodeReview);
  add(
    TaskStatus.Reviewing,
    TaskStatus.WaitingCodeReview,
    TaskStatus.Approved,
    TaskStatus.ChangesRequested,
  );
  add(TaskStatus.Merging, TaskStatus.PrOpen);
  // Nobody eligible picked the review up in time: a person reviews instead.
  add(TaskStatus.CodeReviewRequested, TaskStatus.WaitingCodeReview);
  // Human decisions.
  add(TaskStatus.WaitingPlanReview, TaskStatus.ReadyForCode, TaskStatus.PlanChangesRequested, TaskStatus.Split);
  add(
    TaskStatus.WaitingCodeReview,
    TaskStatus.Approved,
    TaskStatus.ChangesRequested,
    TaskStatus.CodeReviewRequested,
  );
  // The PR was merged (sync or a person), or closed without merging (a person decides).
  add(TaskStatus.PrOpen, TaskStatus.Complete, TaskStatus.NeedsHuman);
  add(TaskStatus.NeedsHuman, ...resolveTargets(null));
  // Escalation and cancellation.
  for (const s of ALL_STATUSES) {
    if (STATUS_INFO[s].kind === "active") add(s, TaskStatus.NeedsHuman);
    if (STATUS_INFO[s].cancelable) add(s, TaskStatus.Canceled);
  }
  return Object.fromEntries(ALL_STATUSES.map((s) => [s, [...t[s]]])) as Record<
    TaskStatus,
    TaskStatus[]
  >;
})();

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Separation of duties: claiming a task in these statuses is refused to whoever
 * produced the named phase's artifact (nobody reviews their own code).
 */
export const SEPARATION: Partial<Record<TaskStatus, Phase>> = {
  [TaskStatus.CodeReviewRequested]: "code",
  [TaskStatus.PlanReviewRequested]: "plan",
};

// ─── Autonomy, risk and task types ────────────────────────────────────

export type AutonomyLevel = 0 | 1 | 2 | 3;
export type Risk = "low" | "medium" | "high";
export type TaskType = "feature" | "bug" | "refactor" | "docs" | "chore";
export type Verdict = "approve" | "request_changes" | "needs_human";
export type Severity = "blocker" | "major" | "minor" | "nit";
export type FindingStatus = "open" | "fixed" | "wontfix" | "verified";
export type CriterionStatus = "pending" | "met" | "failed" | "waived";
export type VerifyKind = "command" | "test" | "manual" | "review";

export const DEFAULT_AUTONOMY: AutonomyLevel = 2;

export const AUTONOMY_LEVELS: Record<AutonomyLevel, { label: string; description: string }> = {
  0: {
    label: "L0 Supervised",
    description: "A person approves the plan, reviews the code and merges the PR. AI reviews only on request.",
  },
  1: {
    label: "L1 Human plan",
    description: "A person approves the plan; agents review the code, and the task reaches the PR without a click.",
  },
  2: {
    label: "L2 Human PR",
    description: "Agents review each other; a person approves risky plans, answers escalations and merges the PR.",
  },
  3: {
    label: "L3 Autonomous",
    description: "Like L2, for low-risk work (docs, tests, chores): a green, low-risk PR may merge itself.",
  },
};

export const RISKS: Record<Risk, { label: string; description: string }> = {
  low: { label: "Low", description: "Docs, tests, small isolated changes." },
  medium: { label: "Medium", description: "Regular features and fixes." },
  high: { label: "High", description: "Migrations, auth, CI, public APIs: a person reviews the code too." },
};

export interface TaskTypeInfo {
  label: string;
  defaultRisk: Risk;
  /** What agents should do differently for this kind of work. */
  guidance: string;
  /** Description skeleton the portal offers for a new task of this type. */
  template: string;
}

export const TASK_TYPES: Record<TaskType, TaskTypeInfo> = {
  feature: {
    label: "Feature",
    defaultRisk: "medium",
    guidance: "New behaviour: write tests for each acceptance criterion; keep the change within the stated scope.",
    template: "## Goal\n<what users can do after this change, and why>\n\n## Scope\n<what is included>\n",
  },
  bug: {
    label: "Bug",
    defaultRisk: "medium",
    guidance: "First write a test that fails because of the bug, then fix it so the test passes; do not change unrelated behaviour.",
    template: "## Steps to reproduce\n1. <step>\n\n## Expected\n<what should happen>\n\n## Actual\n<what happens instead>\n",
  },
  refactor: {
    label: "Refactor",
    defaultRisk: "medium",
    guidance: "No behaviour change: the existing test suite is the oracle and must pass unchanged (do not edit tests to make them pass).",
    template: "## Why\n<the problem with the current structure>\n\n## Target shape\n<what the code should look like>\n",
  },
  docs: {
    label: "Docs",
    defaultRisk: "low",
    guidance: "Documentation only: do not change code; check that commands and paths you document exist.",
    template: "## What to document\n<topic and audience>\n",
  },
  chore: {
    label: "Chore",
    defaultRisk: "low",
    guidance: "Maintenance (dependencies, config, tooling): keep it mechanical and verify the build and tests still pass.",
    template: "## Change\n<what to update and why>\n",
  },
};

export const RISK_ORDER: Risk[] = ["low", "medium", "high"];

/** The higher of two risks (agents and checks may raise risk, never lower it). */
export function maxRisk(a: Risk, b: Risk): Risk {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

/** Findings of these severities block an approve. */
export const BLOCKING_SEVERITIES: Severity[] = ["blocker", "major"];

// ─── Activity ─────────────────────────────────────────────────────────

/** Activity event types written by the workflow, with a short human label. */
export const EVENT_TYPES: Record<string, string> = {
  task_created: "Task created",
  task_claimed: "Claimed",
  plan_submitted: "Plan submitted",
  code_submitted: "Code submitted",
  review_submitted: "Review submitted",
  merge_submitted: "Merge submitted",
  plan_approved: "Plan approved",
  plan_changes_requested: "Plan changes requested",
  code_approved: "Code approved",
  code_changes_requested: "Code changes requested",
  ai_review_requested: "AI review requested",
  task_completed: "Completed",
  task_canceled: "Canceled",
  task_unblocked: "Unblocked",
  task_blocked: "Blocked (needs human)",
  blocker_resolved: "Blocker resolved",
  review_escalated: "Review escalated",
  review_sampled: "Sampled for human review",
  review_starved: "No reviewer picked it up",
  lease_expired: "Claim expired",
  verification_passed: "Verification passed",
  verification_failed: "Verification failed",
  verification_skipped: "Verification skipped",
  risk_raised: "Risk raised",
  dor_warning: "Not ready",
  plan_review_submitted: "Plan critique submitted",
  subtask_created: "Subtask created",
  task_split: "Split into subtasks",
  draft_refined: "Draft refined",
  draft_promoted: "Draft promoted",
  pr_opened: "PR opened",
  pr_merged: "PR merged",
  pr_auto_merged: "PR auto-merged",
  pr_closed: "PR closed without merging",
  task_reverted: "Reverted",
  task_archived: "Archived",
  comment_added: "Comment",
};

/** Actors whose events count as human decisions. */
export const HUMAN_ACTOR = "user";

// ─── Inbox ────────────────────────────────────────────────────────────

export interface InboxReason {
  /** What a person is asked to do, in a few words. */
  action: string;
  /** Sort key: most urgent first (lower first), then oldest. */
  priority: number;
}

/**
 * Why a task is waiting for a person, or null when it is not. The portal's
 * "Needs you" inbox lists these, oldest first within each kind.
 */
export function inboxReason(task: {
  status: string;
  blocker?: { question: string } | null;
  risk?: string;
  dorIssues?: string[];
}): InboxReason | null {
  switch (task.status) {
    case TaskStatus.NeedsHuman:
      return { action: task.blocker?.question ? `Answer: ${task.blocker.question}` : "Decide how to continue", priority: 0 };
    case TaskStatus.WaitingPlanReview:
      return { action: `Approve the plan${task.risk === "high" ? " (high risk)" : ""}`, priority: 1 };
    case TaskStatus.WaitingCodeReview:
      return { action: `Review the code${task.risk === "high" ? " (high risk)" : ""}`, priority: 2 };
    case TaskStatus.PrOpen:
      return { action: "Review and merge the pull request", priority: 3 };
    case TaskStatus.Draft:
      return task.dorIssues?.length ? { action: "Refine or promote the draft", priority: 4 } : null;
    default:
      return null;
  }
}
