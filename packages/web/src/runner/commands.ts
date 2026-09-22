import { homedir } from "os";
import { join } from "path";
import type { RunnerPermissionMode, RunnerTool } from "@agentq/shared";

export interface CommandContext {
  /** Absolute working directory the tool runs in (the project's repo). */
  cwd: string;
  /** Full prompt text handed to the tool. */
  prompt: string;
  /** Absolute path of the file the prompt was written to. */
  promptFile: string;
  taskId: string;
  role: string;
  model: string | null;
  /** Reasoning effort; only claude, codex and opencode receive it. */
  effort: string | null;
  permissionMode: RunnerPermissionMode;
  extraArgs: string[] | null;
}

export interface BuiltCommand {
  cmd: string[];
  cwd: string;
  env?: Record<string, string>;
}

export type CommandBuilder = (tool: RunnerTool, ctx: CommandContext) => BuiltCommand;

/** `~/agentq` unless AGENTQ_HOME overrides it (tests point it at a temp dir). */
export function agentqHome(): string {
  const raw = process.env.AGENTQ_HOME;
  if (!raw) return join(homedir(), "agentq");
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return raw;
}

export function runsDir(taskId: string): string {
  return join(agentqHome(), "runs", taskId);
}

/** Tools known to refuse to start inside another Claude Code session. */
const STRIPPED_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

export function childEnv(ctx: CommandContext, extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !STRIPPED_ENV.includes(k)) env[k] = v;
  }
  env.AGENTQ_TASK_ID = ctx.taskId;
  env.AGENTQ_ROLE = ctx.role;
  env.AGENTQ_PROMPT_FILE = ctx.promptFile;
  return { ...env, ...extra };
}

const CLAUDE_SAFE_TOOLS = [
  "Bash(agentq:*)",
  "Bash(git:*)",
  "Bash(gh:*)",
  "Bash(bun:*)",
  "Bash(npm:*)",
  "Bash(npx:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(grep:*)",
  "Bash(find:*)",
  "Edit",
  "Write",
  "Read",
  "Glob",
  "Grep",
];

export function buildCommand(tool: RunnerTool, ctx: CommandContext): BuiltCommand {
  const extra = ctx.extraArgs ?? [];
  switch (tool) {
    case "claude": {
      const cmd = ["claude", "-p", ctx.prompt, "--output-format", "json"];
      if (ctx.permissionMode === "full") {
        cmd.push("--dangerously-skip-permissions");
      } else {
        cmd.push("--permission-mode", "acceptEdits", "--allowedTools", ...CLAUDE_SAFE_TOOLS);
      }
      if (ctx.model) cmd.push("--model", ctx.model);
      if (ctx.effort) cmd.push("--effort", ctx.effort);
      cmd.push(...extra);
      return { cmd, cwd: ctx.cwd, env: childEnv(ctx) };
    }
    case "codex": {
      const cmd = ["codex", "exec"];
      cmd.push(
        ctx.permissionMode === "full" ? "--dangerously-bypass-approvals-and-sandbox" : "--full-auto",
      );
      cmd.push("-C", ctx.cwd, "--skip-git-repo-check");
      if (ctx.model) cmd.push("-m", ctx.model);
      // `-c` values are parsed as TOML, so the string must be quoted.
      if (ctx.effort) cmd.push("-c", `model_reasoning_effort="${ctx.effort}"`);
      cmd.push(...extra, ctx.prompt);
      return { cmd, cwd: ctx.cwd, env: childEnv(ctx) };
    }
    case "opencode": {
      const cmd = ["opencode", "run", "--dir", ctx.cwd, "--format", "json", "--auto"];
      if (ctx.model) cmd.push("-m", ctx.model);
      if (ctx.effort) cmd.push("--variant", ctx.effort);
      cmd.push(...extra, ctx.prompt);
      return { cmd, cwd: ctx.cwd, env: childEnv(ctx) };
    }
    case "gemini": {
      const cmd = ["gemini", "-p", ctx.prompt, "--yolo"];
      if (ctx.model) cmd.push("-m", ctx.model);
      cmd.push(...extra);
      return { cmd, cwd: ctx.cwd, env: childEnv(ctx) };
    }
    case "custom": {
      if (extra.length === 0) {
        throw new Error("custom runners need extraArgs (the full argv to execute)");
      }
      return {
        cmd: [...extra, ctx.prompt],
        cwd: ctx.cwd,
        env: childEnv(ctx, { AGENTQ_PROMPT: ctx.prompt }),
      };
    }
    default: {
      const never: never = tool;
      throw new Error(`Unknown runner tool: ${String(never)}`);
    }
  }
}

/** Binary the tool needs on PATH (used for install detection). */
export function toolBinary(tool: RunnerTool): string | null {
  switch (tool) {
    case "claude":
    case "codex":
    case "opencode":
    case "gemini":
      return tool;
    case "custom":
      return null;
  }
}
