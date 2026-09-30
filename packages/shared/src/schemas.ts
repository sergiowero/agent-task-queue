import { z } from "zod";
import { ROLES, TaskStatus, normalizeRoles } from "./catalog.js";
import { parseCriterionLine } from "./criteria.js";

export const riskSchema = z.enum(["low", "medium", "high"]);
export const taskTypeSchema = z.enum(["feature", "bug", "refactor", "docs", "chore"]);
export const autonomySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const verdictSchema = z.enum(["approve", "request_changes", "needs_human"]);
export const severitySchema = z.enum(["blocker", "major", "minor", "nit"]);

/** A criterion as text, or as an object with how it is verified. */
export const criterionInputSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    // "text $ command" means: verified by running command.
    const { text, command } = parseCriterionLine(v);
    return command ? { text, verify: { kind: "command", command } } : { text };
  },
  z.object({
    id: z.string().optional(),
    text: z.string().trim().min(1),
    verify: z
      .object({
        kind: z.enum(["command", "test", "manual", "review"]),
        command: z.string().optional(),
        notes: z.string().optional(),
      })
      .optional(),
    status: z.enum(["pending", "met", "failed", "waived"]).optional(),
  }),
);

/** A list of criteria; blank string entries are dropped (older clients send them). */
export const criteriaInputSchema = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => !(typeof x === "string" && !x.trim())) : v),
  z.array(criterionInputSchema),
);

export const referenceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(1000).describe("URL, file path or issue id"),
});

const listOfLines = z.array(z.string().max(2000)).max(50);

export const projectProfileSchema = z
  .object({
    commands: z
      .object({
        install: z.string().max(500),
        build: z.string().max(500),
        test: z.string().max(500),
        lint: z.string().max(500),
        typecheck: z.string().max(500),
      })
      .partial(),
    protectedPaths: z.array(z.string().max(300)).max(100),
    guardrails: z.array(z.string().max(1000)).max(50),
    maxDiffLines: z.number().int().min(10).max(100_000),
    verifyTimeoutSec: z.number().int().min(10).max(7200),
    verifyAllowlist: z.array(z.string().max(300)).max(100),
    autoArchive: z.boolean(),
    dorMode: z.enum(["warn", "enforce", "off"]),
  })
  .partial()
  .strict();

/** Project overrides of the default policy (every key optional). */
export const policySettingsSchema = z
  .object({
    maxPlanRounds: z.number().int().min(1).max(10),
    maxReviewRounds: z.number().int().min(1).max(10),
    maxVerifyFailures: z.number().int().min(1).max(10),
    requireDifferentModel: z.boolean(),
    humanSampleEvery: z.number().int().min(0).max(1000),
    reviewStarvationMin: z.number().int().min(0).max(24 * 60),
    leaseMin: z.number().int().min(5).max(24 * 60),
    autoMerge: z.boolean(),
  })
  .partial()
  .strict();

export const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).default(""),
  steerDetails: z.string().max(5000).optional(),
  guardrails: z.array(z.string()).optional(),
  acceptanceCriteria: criteriaInputSchema.optional(),
  priority: z.number().int().min(0).optional(),

  recommendedBranch: z.string().max(200).optional(),
  requiresPlan: z.boolean().optional(),
  mergeBranch: z.string().max(200).optional(),
  projectId: z.string().uuid(),
  type: taskTypeSchema.optional(),
  risk: riskSchema.optional(),
  autonomy: autonomySchema.nullable().optional(),
  nonGoals: listOfLines.optional(),
  references: z.array(referenceSchema).max(30).optional(),
  /** Start as a draft that a refiner (or a person) makes ready. */
  draft: z.boolean().optional(),
});

/**
 * Fields a person may edit on a task. Status, claim, history and conversation
 * only change through workflow actions, so they are rejected here (strict).
 */
export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    steerDetails: z.string().max(5000).nullable().optional(),
    guardrails: z.array(z.string()).optional(),
    acceptanceCriteria: criteriaInputSchema.optional(),
    priority: z.number().int().min(0).optional(),
    recommendedBranch: z.string().max(200).optional(),
    realBranch: z.string().max(200).nullable().optional(),
    mergeBranch: z.string().max(200).optional(),
    projectId: z.string().uuid().nullable().optional(),
    worktreePath: z.string().max(500).nullable().optional(),
    type: taskTypeSchema.optional(),
    risk: riskSchema.optional(),
    autonomy: autonomySchema.nullable().optional(),
    nonGoals: listOfLines.optional(),
    references: z.array(referenceSchema).max(30).optional(),
  })
  .strict();

/** A person's action on a task (agent submissions have their own schemas, see agentSubmitSchemas). */
export const transitionTaskSchema = z.object({
  action: z.enum([
    "approve_plan",
    "request_plan_changes",
    "approve_code",
    "request_code_changes",
    "request_pr_changes",
    "request_ai_review",
    "complete",
    "cancel",
    "comment",
    "unblock",
    "resolve_blocker",
    "promote_draft",
    "archive",
  ]),
  authorName: z.string().optional(),
  message: z.string().max(10000).optional(),
  // resolve_blocker
  answer: z.string().max(10000).optional(),
  targetStatus: z.nativeEnum(TaskStatus).optional(),
  // archive
  force: z.boolean().optional(),
  pullRequests: z.array(z.string().min(1).max(500)).max(20).optional(),
  overview: z.string().max(20000).optional(),
});

// ─── Agent submissions ─────────────────────────────────────────────────
// The arguments of the agent tools, shared by the MCP server (the tool input
// schemas) and the HTTP API (the request bodies), so both accept and refuse
// the same things.

export const authorSchema = z
  .string()
  .optional()
  .describe('Author name recorded on the conversation entry (default: "agent")');

/** Optional context notes (claim_task, create_task, report_blocker). */
export const contextSchema = z
  .string()
  .optional()
  .describe("Context entry appended to the task for future agents (decisions, gotchas, pointers)");

/** The handoff summary every submit_* that hands work on must carry. */
export const submitContextSchema = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .describe(
    "Required handoff notes appended to task.contexts for the next agent: decisions taken, gotchas, what the next phase should check",
  );

export const handoffListSchema = z.array(z.string().min(1)).max(20).optional();

/** `context` plus the structured lists of a handoff. */
const handoffFields = {
  context: submitContextSchema,
  decisions: handoffListSchema.describe("Decisions taken, and why (for the next phase)"),
  risks: handoffListSchema.describe("What could go wrong or is still uncertain"),
  next: handoffListSchema.describe("What the next phase should do or check first"),
};

export const evidenceInputSchema = z.object({
  kind: z.enum(["command", "manual"]),
  criterionId: z.string().optional().describe("Acceptance criterion this checks (e.g. AC1)"),
  command: z.string().optional().describe("The command you ran"),
  exitCode: z.number().int().optional(),
  summary: z.string().min(1).describe("The relevant output lines, not the whole log"),
});

export const findingInputSchema = z.object({
  severity: severitySchema.describe("blocker and major block approval; minor and nit do not"),
  file: z.string().optional(),
  line: z.number().int().optional(),
  text: z.string().min(1).describe("What is wrong and what to do instead"),
});

export const verifiedFindingSchema = z.object({ id: z.string().min(1), status: z.enum(["verified", "open"]) });

/** The author's answer to an open finding (a coder to R…/H…, a planner to P…). */
function findingResolutionSchema(example: string) {
  return z.object({
    id: z.string().min(1).describe(`Finding id, e.g. ${example}`),
    status: z.enum(["fixed", "wontfix"]),
    resolution: z.string().min(1).describe("How you fixed it, or why not"),
  });
}

export const openQuestionSchema = z.object({ text: z.string().min(1), blocking: z.boolean().default(false) });

export const validationPlanSchema = z.object({
  items: z
    .array(
      z.object({
        criterionId: z.string().min(1).describe("Acceptance criterion id (AC1, AC2, ...)"),
        how: z.string().min(1).describe("How it is verified (alone, without command: a manual check)"),
        command: z.string().optional().describe("A command that proves it (the verifier runs it)"),
        newTests: z.array(z.string()).optional().describe("Test files the coder must add"),
      }),
    )
    .describe("At least one item per acceptance criterion (waived ones excepted)"),
  regressionCommands: z
    .array(z.string())
    .describe("Commands that must keep passing, run in addition to the project's own commands (e.g. bun test src/foo.test.ts)"),
});

export const submitPlanFields = {
  message: z.string().min(1).describe("The plan (markdown)"),
  validationPlan: validationPlanSchema.optional().describe("Required when the task has acceptance criteria"),
  openQuestions: z
    .array(openQuestionSchema)
    .max(20)
    .optional()
    .describe("Questions for a person; a blocking one sends the task to needs_human before anything else"),
  suggestedRisk: riskSchema.optional().describe("Your risk estimate (can only raise the task's risk)"),
  proposedSubtasks: z.array(z.string()).max(20).optional().describe("Subtask titles (create them with create_subtask)"),
  touchedPaths: z.array(z.string()).max(200).optional().describe("Paths the plan will touch; protected ones raise the risk"),
  findingResolutions: z
    .array(findingResolutionSchema("P1-2"))
    .default([])
    .describe("Required when revising: an answer for every open plan finding (P…)"),
  author: authorSchema,
  ...handoffFields,
};

export const submitCodeFields = {
  message: z.string().min(1).describe("Summary of the changes (markdown)"),
  worktree: z.string().min(1).describe("Absolute path of the git worktree containing the changes"),
  branch: z.string().optional().describe("Feature branch the commits are on"),
  headSha: z.string().optional().describe("Head commit (git rev-parse HEAD)"),
  evidence: z.array(evidenceInputSchema).max(50).default([]).describe("Commands you ran and manual checks"),
  criteria: z
    .array(z.object({ id: z.string().min(1), status: z.enum(["met", "failed", "pending"]) }))
    .default([])
    .describe("Your view of each acceptance criterion"),
  findingResolutions: z
    .array(findingResolutionSchema("R1-2"))
    .default([])
    .describe("Required: an answer for every open review finding"),
  author: authorSchema,
  ...handoffFields,
};

export const submitReviewFields = {
  verdict: verdictSchema.describe("approve, request_changes or needs_human"),
  findings: z
    .array(findingInputSchema)
    .max(20)
    .default([])
    .describe("New findings of this round (ids are assigned: R<round>-<n>)"),
  verifiedFindings: z
    .array(verifiedFindingSchema)
    .default([])
    .describe("Earlier findings you checked: verified (fixed) or still open"),
  question: z.string().optional().describe("Required with needs_human: what a person must decide"),
  message: z.string().min(1).describe("Review summary (markdown)"),
  author: authorSchema,
  ...handoffFields,
};

export const submitPlanReviewFields = {
  verdict: verdictSchema,
  findings: z.array(findingInputSchema).max(20).default([]),
  verifiedFindings: z.array(verifiedFindingSchema).default([]),
  suggestedRisk: riskSchema.optional().describe("Raise the task's risk if the plan is riskier than rated"),
  question: z.string().optional().describe("Required with needs_human"),
  message: z.string().min(1).describe("Critique summary (markdown)"),
  author: authorSchema,
  ...handoffFields,
};

export const submitVerificationFields = {
  passed: z.boolean().describe("Every command passed and no tests were weakened"),
  evidence: z.array(evidenceInputSchema).max(100).describe("One entry per command run"),
  tampering: z.array(z.string()).default([]).describe("Tests deleted, skipped or weakened"),
  verifiedSha: z.string().optional().describe("Commit that was verified"),
  author: authorSchema,
  // Optional here only: the built-in verifier reports without a handoff. Agents pass one.
  context: submitContextSchema
    .optional()
    .describe(
      "Handoff notes for the coder (expected from agents): which commands failed and why, and whether the failure is in the code or the environment",
    ),
  decisions: handoffFields.decisions,
  risks: handoffFields.risks,
  next: handoffFields.next,
};

export const submitRefinementFields = {
  description: z.string().optional(),
  acceptanceCriteria: criteriaInputSchema.optional(),
  type: taskTypeSchema.optional(),
  risk: riskSchema.optional(),
  nonGoals: z.array(z.string()).optional(),
  requiresPlan: z.boolean().optional(),
  openQuestions: z.array(openQuestionSchema).optional(),
  message: z.string().min(1).describe("What you changed and why (markdown)"),
  author: authorSchema,
  ...handoffFields,
};

export const submitPrFields = {
  prUrl: z.string().url().optional().describe("URL of the pull request you opened"),
  prNumber: z.number().int().positive().optional().describe("Number of the pull request"),
  mergeBranch: z.string().min(1).describe("Base branch of the pull request (task.mergeBranch)"),
  headBranch: z.string().optional().describe("Feature branch you pushed (defaults to the task's branch)"),
  commit: z.string().min(1).describe("Head commit SHA you pushed"),
  authors: z.string().min(1).describe("Comma-separated list of authors"),
  message: z.string().optional().describe("Notes for the person who merges (markdown)"),
  worktree: z.string().optional().describe("Worktree path the branch was pushed from"),
  author: authorSchema,
  ...handoffFields,
  next: handoffListSchema.describe("What the person merging should check first"),
};

export const reportBlockerFields = {
  reason: z.string().trim().min(1).describe("What blocks you, with the relevant error output (markdown)"),
  question: z
    .string()
    .trim()
    .min(1)
    .describe("The one concrete question or action a person must answer or take to unblock the task"),
  author: authorSchema,
  context: contextSchema,
};

/** Proof of claim over HTTP: the claim_task token, and optionally the claim's agent id. */
const claimProofFields = { claimToken: z.string().optional(), agentId: z.string().optional() };

/**
 * Request bodies of the agent submissions over HTTP: the MCP tool's arguments
 * without taskId (it is in the URL), parsed by the same fields.
 */
export const agentSubmitSchemas = {
  submit_plan: z.object({ ...submitPlanFields, ...claimProofFields }),
  submit_code: z.object({ ...submitCodeFields, ...claimProofFields }),
  submit_review: z.object({ ...submitReviewFields, ...claimProofFields }),
  submit_plan_review: z.object({ ...submitPlanReviewFields, ...claimProofFields }),
  submit_verification: z.object({ ...submitVerificationFields, ...claimProofFields }),
  submit_refinement: z.object({ ...submitRefinementFields, ...claimProofFields }),
  submit_pr: z.object({ ...submitPrFields, ...claimProofFields }),
  submit_merge: z.object({ ...submitPrFields, ...claimProofFields }),
  report_blocker: z.object({ ...reportBlockerFields, ...claimProofFields }),
};

export type AgentSubmitAction = keyof typeof agentSubmitSchemas;

const branchNameSchema = z.string().trim().max(200);

export const createProjectSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  workingDirectory: z.string().min(1).max(1000),
  defaultMergeBranch: branchNameSchema.nullable().optional(),
  autonomy: autonomySchema.optional(),
  policy: policySettingsSchema.optional(),
  profile: projectProfileSchema.optional(),
});

export const updateProjectSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  workingDirectory: z.string().min(1).max(1000).optional(),
  defaultMergeBranch: branchNameSchema.nullable().optional(),
  autonomy: autonomySchema.optional(),
  policy: policySettingsSchema.optional(),
  profile: projectProfileSchema.optional(),
});

export const runnerToolSchema = z.enum(["claude", "codex", "opencode", "gemini", "custom"]);
/** One or more roles; stored without duplicates, in catalog order. */
export const runnerRolesSchema = z.array(z.enum(ROLES)).min(1).transform(normalizeRoles);

export const createRunnerSchema = z.object({
  name: z.string().min(1).max(100),
  tool: runnerToolSchema,
  roles: runnerRolesSchema,
  projectId: z.string().min(1).max(200).nullable().optional(),
  model: z.string().max(200).nullable().optional(),
  effort: z.string().max(40).nullable().optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  pollIntervalSec: z.number().int().min(1).max(3600).optional(),
  permissionMode: z.enum(["safe", "full"]).optional(),
  extraArgs: z.array(z.string()).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const updateRunnerSchema = createRunnerSchema.partial();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TransitionTaskInput = z.infer<typeof transitionTaskSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateRunnerInput = z.infer<typeof createRunnerSchema>;
export type UpdateRunnerInput = z.infer<typeof updateRunnerSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
