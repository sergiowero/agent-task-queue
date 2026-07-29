#!/usr/bin/env bun
import { Command } from "commander";
import type { Task } from "@agentq/shared";
import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  getNextClaimableTask,
  createAgent,
  updateAgentLastSeen,
  getProjects,
  getProjectByTaskId,
  TaskStatus,
  recordHistory,
  addConversation,
  getClaimableStatuses,
  getClaimTransition,
  getEffectiveRole,
} from "@agentq/shared";

const program = new Command();

program.name("agentq").description("AgentQ CLI").version("0.1.0");

// ─── Typed Interfaces ──────────────────────────────────────────────────

interface JsonOption {
  json?: boolean;
}

interface ListOptions extends JsonOption {}

interface ProjectsOptions extends JsonOption {}

interface CreateOptions extends JsonOption {
  project: string;
  description?: string;
  steerDetails?: string;
  guardrails?: string;
  priority?: string;
  branch?: string;
  requiresPlan?: boolean;
  mergeBranch?: string;
  context?: string;
  acceptanceCriteria?: string;
}

interface GetOptions extends JsonOption {}

interface ClaimOptions extends JsonOption {
  name: string;
  version: string;
  model: string;
  role: string;
  sessionId: string;
  host?: string;
  context?: string;
}

interface SubmitPlanOptions extends JsonOption {
  message?: string;
  author?: string;
  context?: string;
}

interface SubmitCodeOptions extends JsonOption {
  message?: string;
  author?: string;
  worktree?: string;
  context?: string;
}

interface SubmitReviewOptions extends JsonOption {
  message?: string;
  author?: string;
  context?: string;
}

interface SubmitMergeOptions extends JsonOption {
  branch: string;
  commit: string;
  authors: string;
  worktree?: string;
  message?: string;
  author?: string;
  context?: string;
}

// ─── JSON Output Helpers ───────────────────────────────────────────────

function jsonOutput(data: Record<string, any>, useJson: boolean | undefined): void {
  if (useJson) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function jsonError(error: string, useJson: boolean | undefined): never {
  if (useJson) {
    console.error(JSON.stringify({ success: false, error }, null, 2));
  } else {
    console.error(error);
  }
  process.exit(1);
}

// ─── Helpers ───────────────────────────────────────────────────────────

function buildAgentRef(toolName: string, model: string) {
  return { name: toolName, tool: toolName, model };
}

function printTask(task: {
  id: string;
  title: string;
  description: string | null;
  steerDetails: string | null;
  guardrails: string[];
  status: string;
  priority: number;
  recommendedBranch: string;
  mergeBranch: string;
  acceptanceCriteria: string[];
  contexts: string[];
  project?: { id: string; displayName: string; workingDirectory: string } | null;
  createdAt: string;
  updatedAt: string;
}) {
  console.log(`  ID:                 ${task.id}`);
  console.log(`  Title:              ${task.title}`);
  console.log(`  Description:        ${task.description || "(none)"}`);
  if (task.project) {
    console.log(`  Project:            ${task.project.displayName} (${task.project.id})`);
  }
  console.log(`  Status:             ${task.status}`);
  console.log(`  Priority:           ${task.priority}`);
  console.log(`  Recommended Branch: ${task.recommendedBranch || "(none)"}`);
  console.log(`  Merge Branch:       ${task.mergeBranch}`);
  if (task.steerDetails) {
    console.log(`  Steer Details:      ${task.steerDetails}`);
  }
  if (task.guardrails.length > 0) {
    console.log(`  Guardrails:`);
    for (const g of task.guardrails) {
      console.log(`    - ${g}`);
    }
  }
  if (task.acceptanceCriteria.length > 0) {
    console.log(`  Acceptance Criteria:`);
    for (const criterion of task.acceptanceCriteria) {
      console.log(`    - ${criterion}`);
    }
  }
  if (task.contexts.length > 0) {
    console.log(`  Context:`);
    for (let i = 0; i < task.contexts.length; i++) {
      console.log(`    #${i + 1}: ${task.contexts[i]}`);
    }
  }
  console.log(`  Created:            ${task.createdAt}`);
  console.log(`  Updated:            ${task.updatedAt}`);
}

// ─── Commands ──────────────────────────────────────────────────────────

program
  .command("list")
  .description("List all tasks")
  .addHelpText("after", "\nExamples:\n  agentq list\n  agentq list --json")
  .option("--json", "Output as JSON")
  .action((options: ListOptions) => {
    const tasks = getTasks();
    if (options.json) {
      const tasksWithProjects = tasks.map((task) => {
        const project = task.projectId ? getProjectByTaskId(task.id) : null;
        return { ...task, project };
      });
      jsonOutput({ success: true, tasks: tasksWithProjects }, true);
      return;
    }
    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }
    for (const task of tasks) {
      const project = task.projectId ? getProjectByTaskId(task.id) : null;
      const projectLabel = project ? ` [${project.displayName}]` : "";
      console.log(
        `[${task.id.slice(0, 8)}] ${task.title}${projectLabel} (${task.status}) P${task.priority}`,
      );
    }
  });

program
  .command("projects")
  .description("List all projects")
  .addHelpText("after", "\nExamples:\n  agentq projects\n  agentq projects --json")
  .option("--json", "Output as JSON")
  .action((options: ProjectsOptions) => {
    const projects = getProjects();
    if (options.json) {
      jsonOutput({ success: true, projects }, true);
      return;
    }
    if (projects.length === 0) {
      console.log("No projects found.");
      return;
    }
    for (const project of projects) {
      console.log(`[${project.id}] ${project.displayName} — ${project.workingDirectory}`);
    }
  });

program
  .command("create <title>")
  .description("Create a new task")
  .addHelpText("after", "\nExamples:\n  agentq create \"Fix login bug\" --project <id> -d \"Description\"\n  agentq create \"Add auth\" --project <id> -d \"Desc\" --requires-plan --json")
  .requiredOption("--project <id>", "Project ID (required)")
  .requiredOption("-d, --description <text>", "Task description")
  .option("--steer-details <text>", "Implementation guidance and technical recommendations")
  .option("--guardrails <text>", "Behavioral constraints (separate multiple with |)")
  .option("-p, --priority <number>", "Priority (default: 0)", "0")
  .option("-b, --branch <name>", "Recommended branch name")
  .option("--requires-plan", "Task requires planning")
  .option("--merge-branch <branch>", "Target merge branch (default: develop)", "develop")
  .option("--context <text>", "Initial context entry")
  .option("-a, --acceptance-criteria <text>", "Acceptance criteria (separate multiple with |)")
  .option("--json", "Output as JSON")
  .action((title: string, options: CreateOptions) => {
    const task = createTask({
      title,
      description: options.description,
      steerDetails: options.steerDetails,
      guardrails: options.guardrails
        ? options.guardrails.split("|").map((s) => s.trim()).filter(Boolean)
        : undefined,
      priority: parseInt(options.priority || "0", 10),
      recommendedBranch: options.branch || "",
      requiresPlan: options.requiresPlan || false,
      mergeBranch: options.mergeBranch || "develop",
      projectId: options.project,
      contexts: options.context ? [options.context] : [],
      acceptanceCriteria: options.acceptanceCriteria
        ? options.acceptanceCriteria.split("|").map((s) => s.trim()).filter(Boolean)
        : undefined,
    });
    if (options.json) {
      const project = getProjectByTaskId(task.id);
      jsonOutput({ success: true, task: { ...task, project } }, true);
      return;
    }
    const project = getProjectByTaskId(task.id);
    console.log("Task created:");
    printTask({ ...task, project });
  });

program
  .command("get <id>")
  .description("Get a task by ID")
  .addHelpText("after", "\nExamples:\n  agentq get <task-id>\n  agentq get <task-id> --json")
  .option("--json", "Output as JSON")
  .action((id: string, options: GetOptions) => {
    const task = getTaskById(id);
    if (!task) {
      jsonError("Task not found.", options.json);
    }
    const project = task!.projectId ? getProjectByTaskId(task!.id) : null;
    if (options.json) {
      jsonOutput({ success: true, task: { ...task!, project } }, true);
      return;
    }
    printTask({ ...task!, project });
  });

// ─── Claim command ─────────────────────────────────────────────────────

program
  .command("claim")
  .description("Claim the highest-priority eligible task for your role")
  .addHelpText("after", "\nExamples:\n  agentq claim -n \"MyAgent\" -v 1.0 -m gpt-4 -r implementer -s <session>\n  agentq claim --name \"MyAgent\" --version 1.0 --model gpt-4 --role senior --session-id <id> --json")
  .requiredOption("-n, --name <name>", "Agent name")
  .requiredOption("-v, --version <version>", "Agent version")
  .requiredOption("-m, --model <model>", "Model identifier")
  .requiredOption(
    "-r, --role <role>",
    "Agent role (planner, implementer, reviewer, senior, architect)",
  )
  .requiredOption("-s, --session-id <sessionId>", "Session ID")
  .option("--host <host>", "Host path")
  .option("--context <text>", "Context entry")
  .option("--json", "Output as JSON")
  .action((options: ClaimOptions) => {
    const { name, version, model, role, sessionId, host, json } = options;

    const claimableStatuses = getClaimableStatuses(role);
    if (claimableStatuses.length === 0) {
      jsonError(
        `Invalid role: ${role}. Must be one of: planner, implementer, reviewer, senior, architect`,
        json,
      );
    }

    const task = getNextClaimableTask(claimableStatuses);
    if (!task) {
      if (json) {
        jsonOutput(
          {
            success: false,
            reason: "no_tasks_available",
            message: "No tasks available for your role.",
          },
          true,
        );
        return;
      }
      console.log("No tasks available for your role.");
      process.exit(0);
    }

    const effectiveRole = getEffectiveRole(task.status, role);
    const newStatus = getClaimTransition(task.status, effectiveRole);
    if (!newStatus) {
      jsonError(`Cannot claim task in ${task.status} status for role ${role}`, json);
    }

    const agent = createAgent({
      toolName: name,
      version,
      model,
      role: effectiveRole,
      sessionId,
      host,
    });

    let updated = updateTask(task.id, {
      status: newStatus,
      assignedAgent: buildAgentRef(agent.toolName, agent.model),
    });

    updated = recordHistory(updated!, newStatus);
    updated = addConversation(updated!, agent.id, `Claimed task. Transitioning to ${newStatus}.`);

    if (options.context) {
      updated = updateTask(updated!.id, {
        contexts: [...(updated!.contexts || []), options.context],
      })!;
    }

    if (json) {
      const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
      jsonOutput(
        {
          success: true,
          task: { ...updated!, project },
          agent: { id: agent.id, role: effectiveRole },
        },
        true,
      );
      return;
    }

    console.log("\nTask claimed successfully!\n");
    const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
    printTask({ ...updated!, project });
  });

// ─── Submit commands ───────────────────────────────────────────────────

program
  .command("submit-plan <taskId>")
  .description("Submit a plan for a claimed task")
  .addHelpText("after", "\nExamples:\n  agentq submit-plan <task-id> -m \"Plan details\"\n  agentq submit-plan <task-id> -m \"Plan\" --author \"agent\" --json")
  .option("-m, --message <message>", "Plan message")
  .option("-a, --author <author>", "Author name", "agent")
  .option("--context <text>", "Context entry")
  .option("--json", "Output as JSON")
  .action((taskId: string, options: SubmitPlanOptions) => {
    const task = getTaskById(taskId);
    if (!task) {
      jsonError("Task not found.", options.json);
    }
    if (task!.status !== TaskStatus.Planning) {
      jsonError("Task must be in Planning status.", options.json);
    }

    const previousStatus = task!.status;
    let updated = recordHistory(task!, TaskStatus.WaitingPlanReview);
    if (options.message) {
      updated = addConversation(updated!, options.author ?? "agent", options.message);
    }
    if (options.context) {
      updated = updateTask(updated!.id, {
        contexts: [...(updated!.contexts || []), options.context],
      })!;
    }
    updated = updateTask(updated!.id, { assignedAgent: null });

    if (options.json) {
      jsonOutput(
        {
          success: true,
          taskId: updated!.id,
          previousStatus,
          newStatus: updated!.status,
          message: "Plan submitted. Task moved to Waiting Plan Review.",
        },
        true,
      );
      return;
    }

    console.log("Plan submitted. Task moved to Waiting Plan Review.");
    const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
    printTask({ ...updated!, project });
  });

program
  .command("submit-code <taskId>")
  .description("Submit code for a claimed task")
  .addHelpText("after", "\nExamples:\n  agentq submit-code <task-id> -w /path/to/worktree -m \"Implemented feature\"\n  agentq submit-code <task-id> --worktree /path --message \"Code\" --json")
  .option("-m, --message <message>", "Code summary")
  .option("-a, --author <author>", "Author name", "agent")
  .requiredOption("-w, --worktree <path>", "Worktree path to store on task")
  .option("--context <text>", "Context entry")
  .option("--json", "Output as JSON")
  .action((taskId: string, options: SubmitCodeOptions) => {
    const task = getTaskById(taskId);
    if (!task) {
      jsonError("Task not found.", options.json);
    }
    if (task!.status !== TaskStatus.Coding) {
      jsonError("Task must be in Coding status.", options.json);
    }

    const previousStatus = task!.status;
    let updated = recordHistory(task!, TaskStatus.WaitingCodeReview);
    if (options.message) {
      updated = addConversation(updated!, options.author ?? "agent", options.message);
    }
    if (options.context) {
      updated = updateTask(updated!.id, {
        contexts: [...(updated!.contexts || []), options.context],
      })!;
    }
    updated = updateTask(updated!.id, {
      assignedAgent: null,
      worktreePath: options.worktree ?? null,
    });

    if (options.json) {
      jsonOutput(
        {
          success: true,
          taskId: updated!.id,
          previousStatus,
          newStatus: updated!.status,
          message: "Code submitted. Task moved to Waiting Code Review.",
        },
        true,
      );
      return;
    }

    console.log("Code submitted. Task moved to Waiting Code Review.");
    const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
    printTask({ ...updated!, project });
  });

program
  .command("submit-review <taskId>")
  .description("Submit a review for a claimed task")
  .addHelpText("after", "\nExamples:\n  agentq submit-review <task-id> -m \"Review findings\"\n  agentq submit-review <task-id> --message \"Looks good\" --json")
  .option("-m, --message <message>", "Review findings")
  .option("-a, --author <author>", "Author name", "agent")
  .option("--context <text>", "Context entry")
  .option("--json", "Output as JSON")
  .action((taskId: string, options: SubmitReviewOptions) => {
    const task = getTaskById(taskId);
    if (!task) {
      jsonError("Task not found.", options.json);
    }
    if (task!.status !== TaskStatus.Reviewing) {
      jsonError("Task must be in Reviewing status.", options.json);
    }

    const previousStatus = task!.status;
    let updated = recordHistory(task!, TaskStatus.WaitingCodeReview);
    if (options.message) {
      updated = addConversation(updated!, options.author ?? "agent", options.message);
    }
    if (options.context) {
      updated = updateTask(updated!.id, {
        contexts: [...(updated!.contexts || []), options.context],
      })!;
    }
    updated = updateTask(updated!.id, { assignedAgent: null });

    if (options.json) {
      jsonOutput(
        {
          success: true,
          taskId: updated!.id,
          previousStatus,
          newStatus: updated!.status,
          message: "Review submitted. Task moved to Waiting Code Review.",
        },
        true,
      );
      return;
    }

    console.log("Review submitted. Task moved to Waiting Code Review.");
    const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
    printTask({ ...updated!, project });
  });

program
  .command("submit-merge <taskId>")
  .description("Submit a merge for a claimed task")
  .addHelpText("after", "\nExamples:\n  agentq submit-merge <task-id> -b main -c abc123 --authors \"dev1,dev2\"\n  agentq submit-merge <task-id> --branch main --commit abc123 --authors \"dev1\" --json")
  .requiredOption("-b, --branch <branch>", "Branch name")
  .requiredOption("-c, --commit <commit>", "Commit hash")
  .requiredOption("--authors <authors>", "Comma-separated list of authors")
  .option("-w, --worktree <worktree>", "Worktree path (optional)")
  .option("-m, --message <message>", "Additional merge message")
  .option("-a, --author <author>", "Author name", "agent")
  .option("--context <text>", "Context entry")
  .option("--json", "Output as JSON")
  .action((taskId: string, options: SubmitMergeOptions) => {
    const task = getTaskById(taskId);
    if (!task) {
      jsonError("Task not found.", options.json);
    }
    if (task!.status !== TaskStatus.Merging) {
      jsonError("Task must be in Merging status.", options.json);
    }

    const mergeDetails = [
      `Branch: ${options.branch}`,
      `Commit: ${options.commit}`,
      `Authors: ${options.authors}`,
      options.worktree ? `Worktree: ${options.worktree}` : null,
      options.message ? `Message: ${options.message}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    const previousStatus = task!.status;
    let updated = recordHistory(task!, TaskStatus.Merged);
    updated = addConversation(
      updated!,
      options.author ?? "agent",
      `Merge submitted. ${mergeDetails}`,
    );
    if (options.context) {
      updated = updateTask(updated!.id, {
        contexts: [...(updated!.contexts || []), options.context],
      })!;
    }
    updated = updateTask(updated!.id, { assignedAgent: null });

    if (options.json) {
      jsonOutput(
        {
          success: true,
          taskId: updated!.id,
          previousStatus,
          newStatus: updated!.status,
          message: "Merge submitted. Task moved to Merged.",
        },
        true,
      );
      return;
    }

    console.log("Merge submitted. Task moved to Merged.");
    const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
    printTask({ ...updated!, project });
  });

program.parse();
