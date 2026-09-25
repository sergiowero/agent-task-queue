import { MCP_SERVER_NAME } from "@agentq/mcp";
import type { Agent, Phase, Project, Task , TaskStatus} from "@agentq/shared";
import { STATUS_INFO, buildAgentBrief, isIndependentPhase, readSkill, skillForPhase, stripFrontmatter } from "@agentq/shared";

export type { Phase };
export { stripFrontmatter };

/** Phase for a status the runner claims from or into (queued or active statuses only). */
export function phaseForStatus(status: TaskStatus): Phase | null {
  const info = STATUS_INFO[status];
  return info && (info.kind === "queued" || info.kind === "active") ? info.phase : null;
}

const CONTEXT_ARG = "<handoff summary for the agent of the next phase>";
const HANDOFF_ARGS = {
  decisions: ["<decision and why>"],
  risks: ["<what could go wrong>"],
  next: ["<what the next phase should check first>"],
};

/** What the `context` handoff notes should tell the agent of the next phase. */
const CONTEXT_HINT: Record<Phase, string> = {
  refine: "what you assumed, what you left for the planner, and anything a person should confirm",
  plan_review: "the verdict, the finding ids the planner must address first, and what you checked",
  plan: "the key decisions and trade-offs, the files the coder should start from, and open questions or risks",
  code: "known limitations or shortcuts and how you verified it (tests run, what was not tested), for the next coding round and the person merging; the reviewer never reads it, it judges the code on its own",
  verify: "which commands failed and why, and whether the failure is in the code or the environment",
  review: "the verdict, the finding ids the coder must fix first and why (or why it is safe to merge)",
  merge: "the PR URL/number, the base and head branches, and what the person merging should check",
};

/** The AgentQ MCP tool that ends each phase, with the arguments to pass. */
export const SUBMIT_TOOL: Record<Phase, (taskId: string) => { tool: string; args: Record<string, unknown> }> = {
  refine: (taskId) => ({
    tool: "submit_refinement",
    args: {
      taskId,
      message: "<markdown: what you changed and why>",
      acceptanceCriteria: ["<testable criterion $ command that proves it>"],
      type: "<feature | bug | refactor | docs | chore>",
      risk: "<low | medium | high>",
      nonGoals: ["<out of scope>"],
      requiresPlan: "<true | false>",
      openQuestions: [{ text: "<question for a person>", blocking: false }],
      context: CONTEXT_ARG,
    },
  }),
  plan_review: (taskId) => ({
    tool: "submit_plan_review",
    args: {
      taskId,
      verdict: "<approve | request_changes | needs_human>",
      findings: [{ severity: "<blocker | major | minor | nit>", text: "<what is wrong with the plan and what to do>" }],
      verifiedFindings: [{ id: "<P1-1>", status: "<verified | open>" }],
      message: "<markdown critique summary>",
      context: CONTEXT_ARG,
      ...HANDOFF_ARGS,
    },
  }),
  plan: (taskId) => ({
    tool: "submit_plan",
    args: {
      taskId,
      message: "<markdown plan>",
      validationPlan: {
        items: [{ criterionId: "<AC1>", how: "<how it is verified>", command: "<command, if any>", newTests: ["<test file>"] }],
        regressionCommands: ["<commands that must keep passing>"],
      },
      openQuestions: [{ text: "<question for a person>", blocking: false }],
      suggestedRisk: "<low | medium | high>",
      touchedPaths: ["<paths the plan changes>"],
      context: CONTEXT_ARG,
      ...HANDOFF_ARGS,
    },
  }),
  code: (taskId) => ({
    tool: "submit_code",
    args: {
      taskId,
      message: "<markdown summary>",
      worktree: "<absolute worktree path>",
      branch: "<feature branch>",
      headSha: "<git rev-parse HEAD>",
      evidence: [{ kind: "command", criterionId: "<AC1>", command: "<command you ran>", exitCode: 0, summary: "<key output lines>" }],
      criteria: [{ id: "<AC1>", status: "<met | failed | pending>" }],
      findingResolutions: [{ id: "<R1-1>", status: "<fixed | wontfix>", resolution: "<how, or why not>" }],
      context: CONTEXT_ARG,
      ...HANDOFF_ARGS,
    },
  }),
  verify: (taskId) => ({
    tool: "submit_verification",
    args: {
      taskId,
      passed: "<true | false>",
      evidence: [{ kind: "command", criterionId: "<AC1>", command: "<command>", exitCode: 0, summary: "<key output lines>" }],
      tampering: ["<tests deleted, skipped or weakened, if any>"],
    },
  }),
  review: (taskId) => ({
    tool: "submit_review",
    args: {
      taskId,
      verdict: "<approve | request_changes | needs_human>",
      findings: [{ severity: "<blocker | major | minor | nit>", file: "<path>", line: 0, text: "<what is wrong and what to do>" }],
      verifiedFindings: [{ id: "<R1-1>", status: "<verified | open>" }],
      message: "<markdown review summary>",
      context: CONTEXT_ARG,
      ...HANDOFF_ARGS,
    },
  }),
  merge: (taskId) => ({
    tool: "submit_pr",
    args: {
      taskId,
      prUrl: "<URL printed by gh pr create>",
      mergeBranch: "<task.mergeBranch>",
      headBranch: "<feature branch you pushed>",
      commit: "<feature-branch head SHA>",
      authors: "<comma-separated authors>",
      worktree: "<task.worktreePath>",
      message: "<markdown notes for the person who merges>",
      context: CONTEXT_ARG,
      ...HANDOFF_ARGS,
    },
  }),
};

export function readPhaseSkill(phase: Phase): string {
  const name = skillForPhase(phase);
  return readSkill(name)?.body ?? `(skill file not found: skills/${name}/SKILL.md)`;
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

  // The brief, not the whole conversation: its size stays flat as review rounds pile up.
  // A phase that checks another agent's work gets the independent one, without the author's context.
  const brief = buildAgentBrief(task);
  const independent = isIndependentPhase(phase);
  const briefIntro = independent
    ? "This is an **independent check**. The brief holds the task, what to check and the findings to verify. It leaves out, on purpose, the conversation, the handoff notes, the messages and the evidence of the agent whose work you check: judge the work itself, not its author's account of it. Do not look for that context elsewhere."
    : "Start from the latest handoffs, the open findings and `humanNotes` (what people said since the last submission). The brief leaves out the full conversation; call `get_task` if you need it.";

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
    "- `get_task_brief` — re-read the brief below (it changes when people comment)",
    independent
      ? "- `get_task` — returns this same independent brief while you hold the task"
      : "- `get_task` — the full task: whole conversation, history and every piece of evidence",
    "- `post_comment` — add a note to the task conversation without changing its status",
    `- \`${submit.tool}\` — submit this phase (see Finish)`,
    "- `report_blocker` — stop because something outside your control blocks the phase (see Finish)",
    "",
    "## Task brief",
    "",
    briefIntro,
    "",
    "```json",
    JSON.stringify(brief, null, 2),
    "```",
    "",
    `## Phase skill: ${skillForPhase(phase)}`,
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
    `\`context\` is required: a short handoff summary for the agent that picks up the next phase. Include ${CONTEXT_HINT[phase]}. Add \`decisions\`, \`risks\` and \`next\` (lists) when you have them. Do not repeat \`message\`.`,
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
