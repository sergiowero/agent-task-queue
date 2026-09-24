import { MCP_SERVER_NAME } from "@agentq/mcp";
import type { Agent, Phase, Project, Task , TaskStatus} from "@agentq/shared";
import { STATUS_INFO, readSkill, stripFrontmatter } from "@agentq/shared";

export type { Phase };
export { stripFrontmatter };

/** Phase for a status the runner claims from or into (queued or active statuses only). */
export function phaseForStatus(status: TaskStatus): Phase | null {
  const info = STATUS_INFO[status];
  return info && (info.kind === "queued" || info.kind === "active") ? info.phase : null;
}

const CONTEXT_ARG = "<handoff notes for the agent of the next phase>";

/** What the `context` handoff notes should tell the agent of the next phase. */
const CONTEXT_HINT: Record<Phase, string> = {
  plan: "the key decisions and trade-offs, the files the coder should start from, and open questions or risks",
  code: "what the reviewer should look at first, known limitations or shortcuts, and how you verified it (tests run, what was not tested)",
  review: "the verdict and the blocking issues the coder must fix next (or why it is safe to merge)",
  merge: "the PR URL/number, the base and head branches, and anything left for the user after the merge",
};

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

export function readPhaseSkill(phase: Phase): string {
  return readSkill(`agentq-${phase}`)?.body ?? `(skill file not found: skills/agentq-${phase}/SKILL.md)`;
}

export interface BuildPromptInput {
  task: Task;
  project: Project | null;
  agent: Agent;
  effectiveRole: string;
  /** The job's claim: every submit for this task must carry it. */
  claimToken?: string;
  /** Overrides the skill body read from disk (tests). */
  phaseSkill?: string;
}

export function buildPrompt(input: BuildPromptInput): string {
  const { task, project, agent, effectiveRole } = input;
  const phase = phaseForStatus(task.status) ?? "code";
  const skill = input.phaseSkill ?? readPhaseSkill(phase);
  const submit = SUBMIT_TOOL[phase](task.id);
  const claim = input.claimToken ? { claimToken: input.claimToken } : {};
  const submitArgs = { ...submit.args, ...claim };
  const blockerArgs = {
    taskId: task.id,
    reason: "<what blocks you, with the relevant error output>",
    question: "<the one question or action a person must answer or take>",
    context: "<what you tried>",
    ...claim,
  };

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
    "- `report_blocker` — stop because something outside your control blocks the phase (see Finish)",
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
    JSON.stringify(submitArgs, null, 2),
    "```",
    "",
    "If something outside your control blocks the phase (push rejected, missing credentials, contradictory or ambiguous task), call `report_blocker` instead. The task goes to a person, who answers; no agent retries it meanwhile:",
    "",
    "```json",
    JSON.stringify(blockerArgs, null, 2),
    "```",
    "",
    `\`context\` is required: short handoff notes, stored in \`task.contexts\`, for the agent that picks up the next phase. Include ${CONTEXT_HINT[phase]}. Do not repeat \`message\`.`,
    "",
    "Rules:",
    "- You are running headless. Never ask for permission or confirmation; decide and proceed.",
    "- Do not claim other tasks. Work only on the task above.",
    "- Write every message in Markdown and always pass `context` handoff notes for the next agent.",
    `- Stop immediately after \`${submit.tool}\` or \`report_blocker\` returns \`"success": true\`.`,
    input.claimToken ? "- Pass `claimToken` exactly as shown on every submit and `report_blocker` call." : "",
    "- If a call returns an error, fix the arguments and call it again. If you cannot finish the phase, call `report_blocker`; never submit partial work to move the task forward.",
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
