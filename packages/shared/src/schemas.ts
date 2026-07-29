import { z } from "zod";
import { TaskStatus } from "./types.js";

const taskStatusValues = Object.values(TaskStatus) as [string, ...string[]];

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
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  steerDetails: z.string().max(5000).nullable().optional(),
  guardrails: z.array(z.string()).optional(),
  status: z.enum(taskStatusValues as [string, ...string[]]).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.number().int().min(0).optional(),
  recommendedBranch: z.string().max(200).optional(),
  realBranch: z.string().max(200).nullable().optional(),
  mergeBranch: z.string().max(200).optional(),
  assignedAgent: z
    .object({
      name: z.string(),
      tool: z.string(),
      model: z.string(),
    })
    .nullable()
    .optional(),
  conversation: z.array(z.any()).optional(),
  history: z.array(z.any()).optional(),
  contexts: z.array(z.string()).optional(),
  projectId: z.string().uuid().nullable().optional(),
  worktreePath: z.string().max(500).nullable().optional(),
});

export const transitionTaskSchema = z.object({
  action: z.enum([
    "submit_plan",
    "submit_code",
    "submit_review",
    "submit_merge",
    "approve_plan",
    "request_plan_changes",
    "approve_code",
    "request_code_changes",
    "request_ai_review",
    "complete",
    "cancel",
    "comment",
    "unblock",
    "set_status",
  ]),
  authorName: z.string().optional(),
  message: z.string().max(10000).optional(),
  targetStatus: z.enum(taskStatusValues as [string, ...string[]]).optional(),
});

export const createProjectSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  workingDirectory: z.string().min(1).max(1000),
});

export const updateProjectSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  workingDirectory: z.string().min(1).max(1000).optional(),
});

export const registerAgentSchema = z.object({
  toolName: z.string().min(1).max(100),
  version: z.string().min(1).max(50),
  model: z.string().min(1).max(100),
  role: z.enum(["planner", "implementer", "reviewer", "senior", "architect"]),
  sessionId: z.string().min(1),
  host: z.string().max(255).optional(),
});

export const claimTaskSchema = z.object({
  agentId: z.string().min(1),
  role: z.enum(["planner", "implementer", "reviewer", "senior", "architect"]),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TransitionTaskInput = z.infer<typeof transitionTaskSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type RegisterAgentInput = z.infer<typeof registerAgentSchema>;
export type ClaimTaskInput = z.infer<typeof claimTaskSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
