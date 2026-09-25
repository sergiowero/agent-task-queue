import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { McpServerLaunch } from "@agentq/mcp";
import { MCP_SERVER_NAME, RUNNER_MCP_TOOLS, mcpServersConfig } from "@agentq/mcp";
import type { RunnerPermissionMode, RunnerTool } from "@agentq/shared";

export interface CommandContext {
  /** Absolute working directory the tool runs in (the project's repo). */
  cwd: string;
  /** Full prompt text handed to the tool. */
  prompt: string;
  /** Absolute path of the file the prompt was written to. */
  promptFile: string;
  /** How to start the AgentQ MCP server, bound to the web server's database. */
  mcp: McpServerLaunch;
  /**
   * Absolute path of the job's `{ "mcpServers": { "agentq": ... } }` file, written
   * by the engine before the tool starts (`<runs>/<taskId>/<jobId>.mcp.json`).
   */
  mcpConfigFile: string;
  taskId: string;
  /** The role the claim acts as (exported as AGENTQ_ROLE). */
  role: string;
  /** Model id as typed on the runner; blank means the tool's own default (no model flag). */
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
  /** Files the engine writes before spawning (e.g. per-job tool settings). */
  files?: { path: string; content: string }[];
}

export type CommandBuilder = (tool: RunnerTool, ctx: CommandContext) => BuiltCommand;

/** `~/.agentq` unless AGENTQ_HOME overrides it (tests point it at a temp dir). */
export function agentqHome(): string {
  const raw = process.env.AGENTQ_HOME;
  if (!raw) return join(homedir(), ".agentq");
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
  // Any tool (custom ones included) can start the AgentQ MCP server from this file.
  env.AGENTQ_MCP_CONFIG = ctx.mcpConfigFile;
  Object.assign(env, ctx.mcp.env);
  return { ...env, ...extra };
}

/** Claude Code names MCP tools `mcp__<server>__<tool>`. */
export const CLAUDE_AGENTQ_TOOLS = RUNNER_MCP_TOOLS.map((tool) => `mcp__${MCP_SERVER_NAME}__${tool}`);

const CLAUDE_SAFE_TOOLS = [
  ...CLAUDE_AGENTQ_TOOLS,
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

/** A TOML basic string or array of them (JSON's escapes are valid TOML). */
function toml(value: string | string[]): string {
  return Array.isArray(value) ? `[${value.map((v) => JSON.stringify(v)).join(", ")}]` : JSON.stringify(value);
}

/** `-c` overrides that add the AgentQ server to Codex's `mcp_servers` for this run. */
export function codexMcpOverrides(mcp: McpServerLaunch): string[] {
  const key = `mcp_servers.${MCP_SERVER_NAME}`;
  const env = Object.entries(mcp.env)
    .map(([k, v]) => `${JSON.stringify(k)} = ${toml(v)}`)
    .join(", ");
  return [
    "-c", `${key}.command=${toml(mcp.command)}`,
    "-c", `${key}.args=${toml(mcp.args)}`,
    "-c", `${key}.env={ ${env} }`,
  ];
}

/**
 * OpenCode reads extra config from OPENCODE_CONFIG_CONTENT (highest precedence).
 * Keeps whatever the environment already puts there.
 */
export function opencodeConfigContent(mcp: McpServerLaunch, existing?: string): string {
  let base: Record<string, any> = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
    } catch {}
  }
  const server = { type: "local", command: [mcp.command, ...mcp.args], environment: mcp.env, enabled: true };
  return JSON.stringify({ ...base, mcp: { ...base.mcp, [MCP_SERVER_NAME]: server } });
}

/** Gemini CLI's system settings file (highest precedence), unless overridden. */
export function geminiSystemSettingsPath(): string {
  const override = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  if (override) return override;
  if (process.platform === "darwin") return "/Library/Application Support/GeminiCli/settings.json";
  if (process.platform === "win32") return "C:\\ProgramData\\gemini-cli\\settings.json";
  return "/etc/gemini-cli/settings.json";
}

/**
 * Gemini CLI has no per-run MCP flag, so the job points GEMINI_CLI_SYSTEM_SETTINGS_PATH
 * at a copy of the system settings with the AgentQ server added. Admin settings in
 * the real file are kept; a file that cannot be read stops the job with a clear error.
 */
export function geminiSettings(mcp: McpServerLaunch, systemPath = geminiSystemSettingsPath()): string {
  let base: Record<string, any> = {};
  if (existsSync(systemPath)) {
    try {
      base = JSON.parse(readFileSync(systemPath, "utf8"));
    } catch (e: any) {
      throw new Error(
        `gemini: cannot add the AgentQ MCP server to this run: ${systemPath} is not readable JSON (${e?.message ?? e}). Fix that file and start the runner again.`,
      );
    }
  }
  const { mcpServers } = mcpServersConfig(mcp);
  return JSON.stringify({ ...base, mcpServers: { ...base.mcpServers, ...mcpServers } }, null, 2);
}

export function buildCommand(tool: RunnerTool, ctx: CommandContext): BuiltCommand {
  const extra = ctx.extraArgs ?? [];
  const model = ctx.model?.trim();
  switch (tool) {
    case "claude": {
      const cmd = ["claude", "-p", ctx.prompt, "--output-format", "json", "--mcp-config", ctx.mcpConfigFile];
      if (ctx.permissionMode === "full") {
        cmd.push("--dangerously-skip-permissions");
      } else {
        cmd.push("--permission-mode", "acceptEdits", "--allowedTools", ...CLAUDE_SAFE_TOOLS);
      }
      if (model) cmd.push("--model", model);
      if (ctx.effort) cmd.push("--effort", ctx.effort);
      cmd.push(...extra);
      return { cmd, cwd: ctx.cwd, env: childEnv(ctx) };
    }
    case "codex": {
      const cmd = ["codex", "exec"];
      cmd.push(
        ctx.permissionMode === "full" ? "--dangerously-bypass-approvals-and-sandbox" : "--full-auto",
      );
      cmd.push("-C", ctx.cwd, "--skip-git-repo-check", ...codexMcpOverrides(ctx.mcp));
      if (model) cmd.push("-m", model);
      // `-c` values are parsed as TOML, so the string must be quoted.
      if (ctx.effort) cmd.push("-c", `model_reasoning_effort="${ctx.effort}"`);
      cmd.push(...extra, ctx.prompt);
      return { cmd, cwd: ctx.cwd, env: childEnv(ctx) };
    }
    case "opencode": {
      const cmd = ["opencode", "run", "--dir", ctx.cwd, "--format", "json", "--auto"];
      if (model) cmd.push("-m", model);
      if (ctx.effort) cmd.push("--variant", ctx.effort);
      cmd.push(...extra, ctx.prompt);
      const content = opencodeConfigContent(ctx.mcp, process.env.OPENCODE_CONFIG_CONTENT);
      return { cmd, cwd: ctx.cwd, env: childEnv(ctx, { OPENCODE_CONFIG_CONTENT: content }) };
    }
    case "gemini": {
      const cmd = ["gemini", "-p", ctx.prompt, "--yolo"];
      if (model) cmd.push("-m", model);
      cmd.push(...extra);
      const settingsFile = ctx.mcpConfigFile.replace(/(\.mcp)?\.json$/, ".gemini-settings.json");
      return {
        cmd,
        cwd: ctx.cwd,
        env: childEnv(ctx, { GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsFile }),
        files: [{ path: settingsFile, content: geminiSettings(ctx.mcp) }],
      };
    }
    case "custom": {
      if (extra.length === 0) {
        throw new Error("custom runners need extraArgs (the full argv to execute)");
      }
      // A custom tool gets the server through $AGENTQ_MCP_CONFIG (see docs/runner.md).
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
