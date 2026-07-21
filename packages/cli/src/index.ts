#!/usr/bin/env bun
import { Command } from "commander";
import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  getNextClaimableTask,
  createAgent,
  updateAgentLastSeen,
  getProjectByTaskId,
  TaskStatus,
  Task,
} from "@atq/shared";

const program = new Command();

program
  .name("atq")
  .description("Agent Task Queue CLI")
  .version("0.1.0");

// ─── Role-to-status mapping ────────────────────────────────────────────

const ROLE_STATUSES: Record<string, TaskStatus[]> = {
  planner: [TaskStatus.PlanRequested, TaskStatus.PlanChangesRequested],
  implementer: [TaskStatus.ReadyForCode, TaskStatus.ChangesRequested, TaskStatus.Approved],
  reviewer: [TaskStatus.CodeReviewRequested],
};

const COMPOUND_ROLES: Record<string, string[]> = {
  senior: ["planner", "implementer", "reviewer"],
  architect: ["planner", "reviewer"],
};

function getClaimableStatuses(role: string): TaskStatus[] {
  if (ROLE_STATUSES[role]) {
    return ROLE_STATUSES[role];
  }
  if (COMPOUND_ROLES[role]) {
    const statuses: TaskStatus[] = [];
    for (const subRole of COMPOUND_ROLES[role]) {
      statuses.push(...ROLE_STATUSES[subRole]);
    }
    return statuses;
  }
  return [];
}

function getClaimTransition(status: TaskStatus, role: string): TaskStatus | null {
  if (role === "planner") {
    if (status === TaskStatus.PlanRequested || status === TaskStatus.PlanChangesRequested) {
      return TaskStatus.Planning;
    }
  }
  if (role === "implementer") {
    if (status === TaskStatus.ReadyForCode || status === TaskStatus.ChangesRequested) {
      return TaskStatus.Coding;
    }
    if (status === TaskStatus.Approved) {
      return TaskStatus.Merging;
    }
  }
  if (role === "reviewer") {
    if (status === TaskStatus.CodeReviewRequested) {
      return TaskStatus.Reviewing;
    }
  }
  if (role === "senior" || role === "architect") {
    return getClaimTransition(status, getEffectiveRole(status, role));
  }
  return null;
}

function getEffectiveRole(status: TaskStatus, compoundRole: string): string {
  if (COMPOUND_ROLES[compoundRole]?.includes("planner")) {
    if (status === TaskStatus.PlanRequested || status === TaskStatus.PlanChangesRequested) {
      return "planner";
    }
  }
  if (COMPOUND_ROLES[compoundRole]?.includes("implementer")) {
    if (status === TaskStatus.ReadyForCode || status === TaskStatus.ChangesRequested || status === TaskStatus.Approved) {
      return "implementer";
    }
  }
  if (COMPOUND_ROLES[compoundRole]?.includes("reviewer")) {
    if (status === TaskStatus.CodeReviewRequested) {
      return "reviewer";
    }
  }
  return compoundRole;
}

// ─── JSON Output Helpers ───────────────────────────────────────────────

function jsonOutput(data: Record<string, any>, useJson: boolean | undefined): void {
  if (useJson) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function jsonError(error: string, useJson: boolean | undefined): void {
  if (useJson) {
    console.log(JSON.stringify({ success: false, error }, null, 2));
    process.exit(1);
  } else {
    console.error(error);
    process.exit(1);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function buildAgentRef(toolName: string, model: string) {
  return { name: toolName, tool: toolName, model };
}

function recordHistory(task: Task, newStatus: TaskStatus): Task {
  const now = new Date().toISOString();
  const history = [
    ...task.history,
    { pre_status: task.status, new_status: newStatus, timestamp: now },
  ];
  return updateTask(task.id, { status: newStatus, history })!;
}

function addConversation(task: Task, authorName: string, message: string): Task {
  const now = new Date().toISOString();
  const conversation = [
    ...task.conversation,
    { authorName, timestamp: now, message },
  ];
  return updateTask(task.id, { conversation })!;
}

function printTask(task: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  recommendedBranch: string;
  mergeBranch: string;
  acceptanceCriteria: string[];
  project?: { id: string; name: string; displayName: string; workingDirectory: string } | null;
  createdAt: string;
  updatedAt: string;
}) {
  console.log(`  ID:                 ${task.id}`);
  console.log(`  Title:              ${task.title}`);
  console.log(`  Description:        ${task.description || "(none)"}`);
  if (task.project) {
    console.log(`  Project:            ${task.project.displayName} (${task.project.name})`);
  }
  console.log(`  Status:             ${task.status}`);
  console.log(`  Priority:           ${task.priority}`);
  console.log(`  Recommended Branch: ${task.recommendedBranch || "(none)"}`);
  console.log(`  Merge Branch:       ${task.mergeBranch}`);
  if (task.acceptanceCriteria.length > 0) {
    console.log(`  Acceptance Criteria:`);
    for (const criterion of task.acceptanceCriteria) {
      console.log(`    - ${criterion}`);
    }
  }
  console.log(`  Created:            ${task.createdAt}`);
  console.log(`  Updated:            ${task.updatedAt}`);
}

// ─── Commands ──────────────────────────────────────────────────────────

program
  .command("list")
  .description("List all tasks")
  .option("--json", "Output as JSON")
  .action((options: { json?: boolean }) => {
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
        `[${task.id.slice(0, 8)}] ${task.title}${projectLabel} (${task.status}) P${task.priority}`
      );
    }
  });

program
  .command("create <title>")
  .description("Create a new task")
  .requiredOption("--project <id>", "Project ID (required)")
  .option("-d, --description <text>", "Task description")
  .option("-p, --priority <number>", "Priority (default: 0)", "0")
  .option("-b, --branch <name>", "Recommended branch name")
  .option("--requires-plan", "Task requires planning")
  .option("--merge-branch <branch>", "Target merge branch (default: develop)", "develop")
  .option("--json", "Output as JSON")
  .action((
    title: string,
    options: {
      project: string;
      description?: string;
      priority?: string;
      branch?: string;
      requiresPlan?: boolean;
      mergeBranch?: string;
      json?: boolean;
    }
  ) => {
    const task = createTask({
      title,
      description: options.description || "",
      priority: parseInt(options.priority || "0", 10),
      recommendedBranch: options.branch || "",
      requiresPlan: options.requiresPlan || false,
      mergeBranch: options.mergeBranch || "develop",
      projectId: options.project,
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
  .option("--json", "Output as JSON")
  .action((id: string, options: { json?: boolean }) => {
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
  .requiredOption("-n, --name <name>", "Agent name")
  .requiredOption("-v, --version <version>", "Agent version")
  .requiredOption("-m, --model <model>", "Model identifier")
  .requiredOption("-r, --role <role>", "Agent role (planner, implementer, reviewer, senior, architect)")
  .requiredOption("-s, --session-id <sessionId>", "Session ID")
  .option("--host <host>", "Host path")
  .option("--json", "Output as JSON")
  .action(
    (options: {
      name: string;
      version: string;
      model: string;
      role: string;
      sessionId: string;
      host?: string;
      json?: boolean;
    }) => {
      const { name, version, model, role, sessionId, host, json } = options;

      const claimableStatuses = getClaimableStatuses(role);
      if (claimableStatuses.length === 0) {
        jsonError(`Invalid role: ${role}. Must be one of: planner, implementer, reviewer, senior, architect`, json);
      }

      const task = getNextClaimableTask(claimableStatuses);
      if (!task) {
        if (json) {
          jsonOutput({ success: false, reason: "no_tasks_available", message: "No tasks available for your role." }, true);
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

      // Create/update agent record
      const agent = createAgent({ toolName: name, version, model, role: effectiveRole, sessionId, host });

      // Update task
      let updated = updateTask(task.id, {
        status: newStatus,
        assignedAgent: buildAgentRef(agent.toolName, agent.model),
      });

      // Record history
      updated = recordHistory(updated!, newStatus);

      // Add conversation entry
      updated = addConversation(updated!, agent.id, `Claimed task. Transitioning to ${newStatus}.`);

      if (json) {
        const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
        jsonOutput({
          success: true,
          task: {
            ...updated!,
            project,
          },
          agent: {
            id: agent.id,
            role: effectiveRole,
          },
        }, true);
        return;
      }

      console.log("\nTask claimed successfully!\n");
      const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
      printTask({ ...updated!, project });
    }
  );

// ─── Submit commands ───────────────────────────────────────────────────

program
  .command("submit-plan <taskId>")
  .description("Submit a plan for a claimed task")
  .option("-m, --message <message>", "Plan message")
  .option("-a, --author <author>", "Author name", "agent")
  .option("--json", "Output as JSON")
  .action((taskId: string, options: { message?: string; author?: string; json?: boolean }) => {
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
    updated = updateTask(updated!.id, { assignedAgent: null });

    if (options.json) {
      jsonOutput({
        success: true,
        taskId: updated!.id,
        previousStatus,
        newStatus: updated!.status,
        message: "Plan submitted. Task moved to Waiting Plan Review.",
      }, true);
      return;
    }

    console.log("Plan submitted. Task moved to Waiting Plan Review.");
    const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
    printTask({ ...updated!, project });
  });

program
  .command("submit-code <taskId>")
  .description("Submit code for a claimed task")
  .option("-m, --message <message>", "Code summary")
  .option("-a, --author <author>", "Author name", "agent")
  .option("-w, --worktree <path>", "Worktree path to store on task")
  .option("--json", "Output as JSON")
  .action((taskId: string, options: { message?: string; author?: string; worktree?: string; json?: boolean }) => {
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
    updated = updateTask(updated!.id, {
      assignedAgent: null,
      worktreePath: options.worktree ?? undefined,
    });

    if (options.json) {
      jsonOutput({
        success: true,
        taskId: updated!.id,
        previousStatus,
        newStatus: updated!.status,
        message: "Code submitted. Task moved to Waiting Code Review.",
      }, true);
      return;
    }

    console.log("Code submitted. Task moved to Waiting Code Review.");
    const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
    printTask({ ...updated!, project });
  });

program
  .command("submit-review <taskId>")
  .description("Submit a review for a claimed task")
  .option("-m, --message <message>", "Review findings")
  .option("-a, --author <author>", "Author name", "agent")
  .option("--json", "Output as JSON")
  .action((taskId: string, options: { message?: string; author?: string; json?: boolean }) => {
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
    updated = updateTask(updated!.id, { assignedAgent: null });

    if (options.json) {
      jsonOutput({
        success: true,
        taskId: updated!.id,
        previousStatus,
        newStatus: updated!.status,
        message: "Review submitted. Task moved to Waiting Code Review.",
      }, true);
      return;
    }

    console.log("Review submitted. Task moved to Waiting Code Review.");
    const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
    printTask({ ...updated!, project });
  });

program
  .command("submit-merge <taskId>")
  .description("Submit a merge for a claimed task")
  .requiredOption("-b, --branch <branch>", "Branch name")
  .requiredOption("-c, --commit <commit>", "Commit hash")
  .requiredOption("--authors <authors>", "Comma-separated list of authors")
  .option("-w, --worktree <worktree>", "Worktree path (optional)")
  .option("-m, --message <message>", "Additional merge message")
  .option("-a, --author <author>", "Author name", "agent")
  .option("--json", "Output as JSON")
  .action(
    (
      taskId: string,
      options: {
        branch: string;
        commit: string;
        authors: string;
        worktree?: string;
        message?: string;
        author?: string;
        json?: boolean;
      }
    ) => {
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
      updated = addConversation(updated!, options.author ?? "agent", `Merge submitted. ${mergeDetails}`);
      updated = updateTask(updated!.id, { assignedAgent: null });

      if (options.json) {
        jsonOutput({
          success: true,
          taskId: updated!.id,
          previousStatus,
          newStatus: updated!.status,
          message: "Merge submitted. Task moved to Merged.",
        }, true);
        return;
      }

      console.log("Merge submitted. Task moved to Merged.");
      const project = updated!.projectId ? getProjectByTaskId(updated!.id) : null;
      printTask({ ...updated!, project });
    }
  );

program.parse();
