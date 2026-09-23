#!/usr/bin/env bun
import { Command } from "commander";
import type { SubmitResult } from "@agentq/shared";
import {
  createTask,
  getTasks,
  getTaskById,
  getProjects,
  getProjectByTaskId,
  getClaimableStatuses,
  claimNextTask,
  submitPlan,
  submitCode,
  submitReview,
  submitMerge,
  archiveTask,
  WorkflowError,
} from "@agentq/shared";

const program = new Command();

program.name("agentq").description("AgentQ CLI").version("0.1.0");

// ─── Typed Interfaces ──────────────────────────────────────────────────

interface JsonOption {
  json?: boolean;
}

interface ListOptions extends JsonOption {
  status?: string;
  project?: string;
}

interface ProjectsOptions extends JsonOption {}

interface CreateOptions extends JsonOption {
  project: string;
  description: string;
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
  project?: string;
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

interface ArchiveOptions extends JsonOption {
  pr: string[];
  summary?: string;
  dir?: string;
  force?: boolean;
  author?: string;
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

/** Runs a shared workflow helper, turning WorkflowError into a CLI error exit. */
function runWorkflow<T>(fn: () => T, useJson: boolean | undefined): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof WorkflowError) {
      jsonError(error.message, useJson);
    }
    throw error;
  }
}

function printSubmitResult(result: SubmitResult, useJson: boolean | undefined): void {
  if (useJson) {
    jsonOutput(
      {
        success: true,
        taskId: result.task.id,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        message: result.message,
      },
      true,
    );
    return;
  }

  console.log(result.message);
  const project = result.task.projectId ? getProjectByTaskId(result.task.id) : null;
  printTask({ ...result.task, project });
}

// ─── Helpers ───────────────────────────────────────────────────────────

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
  .description("List all tasks (archived tasks are left out)")
  .addHelpText(
    "after",
    "\nExamples:\n  agentq list\n  agentq list --json\n  agentq list --status complete --project <id> --json",
  )
  .option("--status <status>", "Only tasks in this status (e.g. complete)")
  .option("--project <id>", "Only tasks of this project")
  .option("--json", "Output as JSON")
  .action((options: ListOptions) => {
    const tasks = getTasks(options.project).filter(
      (task) => !options.status || task.status === options.status,
    );
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
  .option("--project <id>", "Only claim tasks from this project")
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

    const result = claimNextTask({
      role,
      agent: { toolName: name, version, model, sessionId, host },
      context: options.context,
      projectId: options.project,
    });
    if (!result) {
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

    const { task: updated, agent, effectiveRole } = result;

    if (json) {
      const project = updated.projectId ? getProjectByTaskId(updated.id) : null;
      jsonOutput(
        {
          success: true,
          task: { ...updated, project },
          agent: { id: agent.id, role: effectiveRole },
        },
        true,
      );
      return;
    }

    console.log("\nTask claimed successfully!\n");
    const project = updated.projectId ? getProjectByTaskId(updated.id) : null;
    printTask({ ...updated, project });
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
    const result = runWorkflow(
      () =>
        submitPlan(taskId, {
          message: options.message,
          author: options.author,
          context: options.context,
        }),
      options.json,
    );
    printSubmitResult(result, options.json);
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
    const result = runWorkflow(
      () =>
        submitCode(taskId, {
          message: options.message,
          author: options.author,
          worktree: options.worktree,
          context: options.context,
        }),
      options.json,
    );
    printSubmitResult(result, options.json);
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
    const result = runWorkflow(
      () =>
        submitReview(taskId, {
          message: options.message,
          author: options.author,
          context: options.context,
        }),
      options.json,
    );
    printSubmitResult(result, options.json);
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
    const result = runWorkflow(
      () =>
        submitMerge(taskId, {
          branch: options.branch,
          commit: options.commit,
          authors: options.authors,
          worktree: options.worktree,
          message: options.message,
          author: options.author,
          context: options.context,
        }),
      options.json,
    );
    printSubmitResult(result, options.json);
  });

// ─── Archive command ───────────────────────────────────────────────────

program
  .command("archive <taskId>")
  .description(
    "Archive a complete task: write a summary and a detailed Markdown record to {project}/archive/ and take it off the board",
  )
  .addHelpText(
    "after",
    "\nExamples:\n  agentq archive <task-id> --json\n  agentq archive <task-id> --pr https://github.com/org/repo/pull/42 --summary \"## Overview\\n- ...\" --json",
  )
  .option(
    "--pr <url>",
    "Pull request URL or ref to record (repeatable; PRs in the conversation are found automatically)",
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .option("--summary <markdown>", "Overview of what was done, placed at the top of the summary file")
  .option("--dir <path>", "Write the files here instead of {project}/archive")
  .option("--force", "Archive again a task that is already archived (rewrites its files)")
  .option("-a, --author <author>", "Author recorded on the task", "agent")
  .option("--json", "Output as JSON")
  .action((taskId: string, options: ArchiveOptions) => {
    const result = runWorkflow(
      () =>
        archiveTask(taskId, {
          pullRequests: options.pr,
          overview: options.summary,
          directory: options.dir,
          force: options.force,
          actor: options.author,
        }),
      options.json,
    );
    if (options.json) {
      jsonOutput(
        {
          success: true,
          taskId: result.task.id,
          archivedAt: result.task.archivedAt,
          directory: result.directory,
          summaryPath: result.summaryPath,
          detailedPath: result.detailedPath,
          pullRequests: result.pullRequests,
        },
        true,
      );
      return;
    }
    console.log(`Task archived: ${result.task.title}`);
    console.log(`  Summary:       ${result.summaryPath}`);
    console.log(`  Full record:   ${result.detailedPath}`);
    console.log(`  Pull requests: ${result.pullRequests.join(", ") || "(none found)"}`);
  });

program.parse();
