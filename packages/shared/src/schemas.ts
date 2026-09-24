import { z } from "zod";
import { ROLES, TaskStatus } from "./catalog.js";

export const riskSchema = z.enum(["low", "medium", "high"]);
export const taskTypeSchema = z.enum(["feature", "bug", "refactor", "docs", "chore"]);
export const autonomySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const verdictSchema = z.enum(["approve", "request_changes", "needs_human"]);
export const severitySchema = z.enum(["blocker", "major", "minor", "nit"]);

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
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.number().int().min(0).optional(),

  recommendedBranch: z.string().max(200).optional(),
  requiresPlan: z.boolean().optional(),
  mergeBranch: z.string().max(200).optional(),
  projectId: z.string().uuid(),
  type: taskTypeSchema.optional(),
  risk: riskSchema.optional(),
  autonomy: autonomySchema.nullable().optional(),
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
    acceptanceCriteria: z.array(z.string()).optional(),
    priority: z.number().int().min(0).optional(),
    recommendedBranch: z.string().max(200).optional(),
    realBranch: z.string().max(200).nullable().optional(),
    mergeBranch: z.string().max(200).optional(),
    projectId: z.string().uuid().nullable().optional(),
    worktreePath: z.string().max(500).nullable().optional(),
    type: taskTypeSchema.optional(),
    risk: riskSchema.optional(),
    autonomy: autonomySchema.nullable().optional(),
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
});

export const updateProjectSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  workingDirectory: z.string().min(1).max(1000).optional(),
  defaultMergeBranch: branchNameSchema.nullable().optional(),
  autonomy: autonomySchema.optional(),
  policy: policySettingsSchema.optional(),
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
