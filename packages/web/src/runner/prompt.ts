import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { MCP_SERVER_NAME } from "@agentq/mcp";
import type { Agent, Project, Task } from "@agentq/shared";
import { TaskStatus } from "@agentq/shared";

export type Phase = "plan" | "code" | "review" | "merge";

const PHASE_BY_STATUS: Partial<Record<TaskStatus, Phase>> = {
  [TaskStatus.PlanRequested]: "plan",
  [TaskStatus.PlanChangesRequested]: "plan",
  [TaskStatus.Planning]: "plan",
  [TaskStatus.ReadyForCode]: "code",
  [TaskStatus.ChangesRequested]: "code",
  [TaskStatus.Coding]: "code",
  [TaskStatus.CodeReviewRequested]: "review",
  [TaskStatus.Reviewing]: "review",
  [TaskStatus.Approved]: "merge",
  [TaskStatus.Merging]: "merge",
};

/** Phase for a status, accepting both the claimable and the active (claimed) status. */
export function phaseForStatus(status: TaskStatus): Phase | null {
  return PHASE_BY_STATUS[status] ?? null;
}

const CONTEXT_ARG = "<short summary of the state, findings or blockers for the next agent>";

/** The AgentQ MCP tool that ends each phase, with the arguments to pass. */
export const SUBMIT_TOOL: Record<Phase, (taskId: string) => { tool: string; args: Record<string, string> }> = {
  plan: (taskId) => ({
    tool: "submit_plan",
    args: { taskId, message: "<markdown plan>", context: CONTEXT_ARG },
  }),
  code: (taskId) => ({
    tool: "submit_code",
    args: { taskId, message: "<markdown summary>", worktree: "<absolute worktree path>", context: CONTEXT_ARG },
  }),
  review: (taskId) => ({
    tool: "submit_review",
    args: { taskId, message: "<markdown findings with verdict>", context: CONTEXT_ARG },
  }),
  merge: (taskId) => ({
    tool: "submit_merge",
    args: {
      taskId,
      mergeBranch: "<task.mergeBranch>",
      commit: "<feature-branch head SHA>",
      authors: "<comma-separated authors>",
      worktree: "<task.worktreePath>",
      message: "<markdown with the PR URL>",
      context: CONTEXT_ARG,
    },
  }),
};

const SKILLS_DIR = resolve(import.meta.dir, "../../../../skills");

/** Strips the leading `--- ... ---` YAML frontmatter block, if present. */
export function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? md.slice(m[0].length).trimStart() : md;
}

export function readPhaseSkill(phase: Phase): string {
  const file = resolve(SKILLS_DIR, `agentq-${phase}`, "SKILL.md");
  if (!existsSync(file)) return `(skill file not found: ${file})`;
  return stripFrontmatter(readFileSync(file, "utf8"));
}

export interface BuildPromptInput {
  task: Task;
  project: Project | null;
  agent: Agent;
  effectiveRole: string;
  /** Overrides the skill body read from disk (tests). */
  phaseSkill?: string;
}

export function buildPrompt(input: BuildPromptInput): string {
  const { task, project, agent, effectiveRole } = input;
  const phase = phaseForStatus(task.status) ?? "code";
  const skill = input.phaseSkill ?? readPhaseSkill(phase);
  const submit = SUBMIT_TOOL[phase](task.id);

  const taskJson = {
    id: task.id,
    title: task.title,
    description: task.description,
    steerDetails: task.steerDetails,
    guardrails: task.guardrails,
    acceptanceCriteria: task.acceptanceCriteria,
    priority: task.priority,
    status: task.status,
    requiresPlan: task.requiresPlan,
    recommendedBranch: task.recommendedBranch,
    realBranch: task.realBranch,
    mergeBranch: task.mergeBranch,
    worktreePath: task.worktreePath,
    contexts: task.contexts,
    conversation: task.conversation,
    project: project
      ? { id: project.id, displayName: project.displayName, workingDirectory: project.workingDirectory }
      : null,
  };

  return [
    `# AgentQ ${effectiveRole} agent`,
    "",
    `You are an AgentQ **${effectiveRole}** agent (agent id \`${agent.id}\`, tool ${agent.toolName}, model ${agent.model}).`,
    `Task \`${task.id}\` has ALREADY been claimed for you by the runner. Do **NOT** call \`claim_task\`.`,
    `Current status: \`${task.status}\` (phase: ${phase}).`,
    project ? `Project working directory: \`${project.workingDirectory}\` (you are running inside it).` : "",
    "",
    "## AgentQ MCP tools",
    "",
    `This run has the \`${MCP_SERVER_NAME}\` MCP server (Claude Code names its tools \`mcp__${MCP_SERVER_NAME}__<tool>\`). Do all queue work through its tools:`,
    "",
    "- `get_task` — re-read this task (conversation, contexts, worktree path)",
    "- `post_comment` — add a note to the task conversation without changing its status",
    `- \`${submit.tool}\` — submit this phase (see Finish)`,
    "",
    "## Task",
    "",
    "```json",
    JSON.stringify(taskJson, null, 2),
    "```",
    "",
    `## Phase skill: agentq-${phase}`,
    "",
    skill.trim(),
    "",
    "## Finish",
    "",
    `When the work for this phase is done, call the \`${submit.tool}\` tool of the \`${MCP_SERVER_NAME}\` MCP server with:`,
    "",
    "```json",
    JSON.stringify(submit.args, null, 2),
    "```",
    "",
    "Rules:",
    "- You are running headless. Never ask for permission or confirmation; decide and proceed.",
    "- Do not claim other tasks. Work only on the task above.",
    "- Write every message in Markdown and pass a short `context` for the next agent.",
    `- Stop immediately after \`${submit.tool}\` returns \`"success": true\`.`,
    "- If it returns an error, fix the arguments and call it again. If you cannot complete the phase, still submit with a message explaining what blocks you.",
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
