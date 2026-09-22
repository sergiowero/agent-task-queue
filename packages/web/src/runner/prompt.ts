import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
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

const SUBMIT_COMMAND: Record<Phase, (taskId: string) => string> = {
  plan: (id) => `agentq submit-plan ${id} --json -m "<markdown plan>"`,
  code: (id) => `agentq submit-code ${id} --json -m "<markdown summary>" --worktree <worktreePath>`,
  review: (id) => `agentq submit-review ${id} --json -m "<markdown findings with verdict>"`,
  merge: (id) => `agentq submit-merge ${id} --json -b <branch> -c <commit> --authors <authors>`,
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
    `Task \`${task.id}\` has ALREADY been claimed for you by the runner. Do **NOT** run \`agentq claim\`.`,
    `Current status: \`${task.status}\` (phase: ${phase}).`,
    project ? `Project working directory: \`${project.workingDirectory}\` (you are running inside it).` : "",
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
    "When the work for this phase is done, submit it with:",
    "",
    "```bash",
    SUBMIT_COMMAND[phase](task.id),
    "```",
    "",
    "Rules:",
    "- You are running headless. Never ask for permission or confirmation; decide and proceed.",
    "- Do not claim other tasks. Work only on the task above.",
    "- Stop immediately after the submit command succeeds.",
    "- If you cannot complete the phase, still submit with a message explaining what blocks you.",
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
