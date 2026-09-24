import { z } from "zod";
import { ROLES, TaskStatus } from "./catalog.js";
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
    conventionFiles: z.array(z.string().max(300)).max(50),
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

export const transitionTaskSchema = z.object({
  action: z.enum([
    "submit_plan",
    "submit_code",
    "submit_review",
    "submit_merge",
    "report_blocker",
    "approve_plan",
    "request_plan_changes",
    "approve_code",
    "request_code_changes",
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
  // submit_* over HTTP: the claim holder's proof
  claimToken: z.string().optional(),
  // submit_review
  verdict: verdictSchema.optional(),
  question: z.string().max(5000).optional(),
  context: z.string().max(10000).optional(),
  // archive
  force: z.boolean().optional(),
  pullRequests: z.array(z.string().min(1).max(500)).max(20).optional(),
  overview: z.string().max(20000).optional(),
});

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
export const runnerRoleSchema = z.enum(ROLES);

export const createRunnerSchema = z.object({
  name: z.string().min(1).max(100),
  tool: runnerToolSchema,
  role: runnerRoleSchema,
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
