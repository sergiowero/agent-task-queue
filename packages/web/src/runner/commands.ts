import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { McpServerLaunch, RUNNER_MCP_TOOLS } from "@moonlightq/mcp";
import { MCP_SERVER_NAME, mcpServersConfig } from "@moonlightq/mcp";
import type { Role, RunnerPermissionMode, RunnerTool } from "@moonlightq/shared";

export interface CommandContext {
  /** Absolute working directory the tool runs in (the project's repo). */
  cwd: string;
  /** Full prompt text handed to the tool. */
  prompt: string;
  /** Absolute path of the file the prompt was written to. */
  promptFile: string;
  /** How to start the MoonlightQ MCP server, bound to the web server's database. */
  mcp: McpServerLaunch;
  /**
   * Absolute path of the job's `{ "mcpServers": { "moonlightq": ... } }` file, written
   * by the engine before the tool starts (`<runs>/<taskId>/<jobId>.mcp.json`).
   */
  mcpConfigFile: string;
  taskId: string;
  /**
   * The role the claim acts as (exported as MOONLIGHTQ_ROLE). In safe mode it decides what the
   * tool may do (see ROLE_ACCESS); a role this file does not know gets the least.
   */
  role: string;
  /**
   * Commands the job may run beyond its role's basics (see the profiles below): the
   * project's own checks and the plan's and criteria's that the verifier would trust.
   * Only the roles that run commands (code, review, verify) use them.
   */
  commands?: readonly string[];
  /** Model id as typed on the runner; blank means the tool's own default (no model flag). */
  model: string | null;
  /**
   * Start the job in a new worktree the tool manages itself, for tools that have the option
   * (codex `--worktree`). Set for a coding job that has no task worktree yet; other tools ignore it.
   */
  toolWorktree?: boolean;
  /** Reasoning effort; only claude, codex, opencode and copilot receive it. */
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

/** `~/.moonlightq` unless MOONLIGHTQ_HOME overrides it (tests point it at a temp dir). */
export function moonlightqHome(): string {
  const raw = process.env.MOONLIGHTQ_HOME;
  if (!raw) return join(homedir(), ".moonlightq");
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return raw;
}

export function runsDir(taskId: string): string {
  return join(moonlightqHome(), "runs", taskId);
}

/** Tools known to refuse to start inside another Claude Code session. */
const STRIPPED_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

export function childEnv(ctx: CommandContext, extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !STRIPPED_ENV.includes(k)) env[k] = v;
  }
  env.MOONLIGHTQ_TASK_ID = ctx.taskId;
  env.MOONLIGHTQ_ROLE = ctx.role;
  env.MOONLIGHTQ_PROMPT_FILE = ctx.promptFile;
  // Any tool (custom ones included) can start the MoonlightQ MCP server from this file.
  env.MOONLIGHTQ_MCP_CONFIG = ctx.mcpConfigFile;
  Object.assign(env, ctx.mcp.env);
  return { ...env, ...extra };
}

// ─── What each role's job may do (safe mode) ──────────────────────────

/**
 * What a role's job may do to the checkout. `read`: look and change nothing (refine, plan,
 * plan critique). `run`: look and re-run the project's checks, in the task's worktree
 * (code review, verification). `publish`: push the branch and open the pull request, no edits
 * (pr). `edit`: change the code (code). Full mode is the user's opt-out from all of it.
 */
export type RoleAccess = "read" | "run" | "publish" | "edit";

export const ROLE_ACCESS: Record<Role, RoleAccess> = {
  refine: "read",
  plan: "read",
  plan_review: "read",
  review: "run",
  verify: "run",
  pr: "publish",
  code: "edit",
};

/** The access of a role; one this file does not know gets the least. */
export function accessOf(role: string): RoleAccess {
  return Object.hasOwn(ROLE_ACCESS, role) ? ROLE_ACCESS[role as Role] : "read";
}

type RunnerMcpTool = (typeof RUNNER_MCP_TOOLS)[number];

/** The MoonlightQ tools every job may call, whatever its role. */
const COMMON_MCP_TOOLS: readonly RunnerMcpTool[] = ["get_task", "get_task_brief", "get_skill", "post_comment", "report_blocker"];

/**
 * The MoonlightQ tools a job of each role may call: the common ones and its own phase's
 * submit (the claim is already the job's: nothing claims, creates or archives tasks).
 */
export const ROLE_MCP_TOOLS: Record<Role, readonly RunnerMcpTool[]> = {
  refine: [...COMMON_MCP_TOOLS, "submit_refinement"],
  plan: [...COMMON_MCP_TOOLS, "submit_plan", "create_subtask"],
  plan_review: [...COMMON_MCP_TOOLS, "submit_plan_review"],
  code: [...COMMON_MCP_TOOLS, "submit_code"],
  verify: [...COMMON_MCP_TOOLS, "submit_verification"],
  review: [...COMMON_MCP_TOOLS, "submit_review"],
  pr: [...COMMON_MCP_TOOLS, "submit_pr"],
};

/** Claude Code names MCP tools `mcp__<server>__<tool>`. */
export function claudeMoonlightqTools(role: string): string[] {
  return moonlightqTools(role).map((tool) => `mcp__${MCP_SERVER_NAME}__${tool}`);
}

/** What a job that must not change anything may run: look at the repository. */
const READ_ONLY_BASH = [
  "Bash(git log:*)",
  "Bash(git diff:*)",
  "Bash(git show:*)",
  "Bash(git status:*)",
  "Bash(git rev-parse:*)",
  "Bash(git rev-list:*)",
  "Bash(git merge-base:*)",
  "Bash(git ls-files:*)",
  "Bash(git blame:*)",
  "Bash(git branch --show-current:*)",
  "Bash(ls:*)",
  "Bash(cd:*)",
];

/** The coder's shell: git and gh, the JavaScript runners and the read-only basics. */
const CODE_BASH = [
  "Bash(git:*)",
  "Bash(gh:*)",
  "Bash(bun:*)",
  "Bash(npm:*)",
  "Bash(npx:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(grep:*)",
  "Bash(find:*)",
];

/** The pull-request phase pushes and opens the PR; it never commits, moves the branch or merges. */
const PUBLISH_BASH = ["Bash(git:*)", "Bash(gh:*)", "Bash(ls:*)", "Bash(cd:*)"];
const PUBLISH_DENIED = [
  ...["commit", "add", "rm", "mv", "reset", "checkout", "switch", "restore", "clean", "stash", "merge", "rebase", "cherry-pick", "apply", "am"].map(
    (sub) => `Bash(git ${sub}:*)`,
  ),
  "Bash(gh pr merge:*)",
];

/** The tools that write files: no job but the coder's has them. */
const EDIT_TOOLS = ["Edit", "Write"];
const EDIT_DENIED = ["Edit", "Write", "NotebookEdit"];

/**
 * Characters a Bash rule can carry as they are. A command with anything else (quotes,
 * globs, substitutions, parentheses, redirections) gets no rule: it could widen the rule or break it.
 */
const RULE_SAFE = /^[\w@%+=,.:/ -]+$/;

/** The simple commands of a shell line: `a && b | c; d` is a, b, c and d. */
function simpleCommands(line: string): string[] {
  return line
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/**
 * One rule per simple command, matching exactly that command: `Bash(pytest -q)` allows
 * `pytest -q` and nothing else, so a job that must not run other code can still re-run
 * the project's checks. Arguments cannot be appended.
 */
export function exactBashRules(commands: readonly string[]): string[] {
  const rules = new Set<string>();
  for (const line of commands) {
    for (const command of simpleCommands(line)) {
      if (RULE_SAFE.test(command)) rules.add(`Bash(${command})`);
    }
  }
  return [...rules];
}

/** Programs whose wildcard rule would allow far more than running the project's checks. */
const NEVER_WIDENED = new Set([
  "rm", "mv", "cp", "chmod", "chown", "dd", "sudo", "su", "kill", "pkill", "curl", "wget", "ssh", "scp",
  "sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh", "env", "eval", "exec", "xargs",
]);

/**
 * A wildcard rule per program of `commands` (`pytest -q`, `make lint` → `Bash(pytest:*)`,
 * `Bash(make:*)`), for the coder, who runs the project's tools with any arguments.
 * Shells, `rm` and the like only get their exact rule.
 */
export function programBashRules(commands: readonly string[]): string[] {
  const rules = new Set<string>();
  for (const line of commands) {
    for (const command of simpleCommands(line)) {
      const words = command.split(" ");
      while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) words.shift();
      const program = words[0];
      if (!program || !/^[\w.+-]+(?:\/[\w.+-]+)*$/.test(program) || program.includes("..")) continue;
      if (!NEVER_WIDENED.has(program)) rules.add(`Bash(${program}:*)`);
    }
  }
  return [...rules];
}

export interface ClaudeSafeProfile {
  /**
   * `acceptEdits` only where the job edits. Any other job gets no `--permission-mode`: a
   * headless run denies what is not allowed, and the flag has no value for "the default"
   * that every Claude Code release accepts.
   */
  permissionMode?: "acceptEdits";
  /** `--allowedTools` */
  allowed: string[];
  /** `--disallowedTools`: wins over `allowed`, and over any allow rule or permission mode in the user's own settings. */
  denied: string[];
}

/** The tools a safe-mode Claude job of `role` gets. `commands`: what the job may run (see CommandContext). */
export function claudeSafeProfile(role: string, commands: readonly string[] = []): ClaudeSafeProfile {
  const access = accessOf(role);
  const mcp = claudeMoonlightqTools(role);
  switch (access) {
    case "edit":
      return {
        permissionMode: "acceptEdits",
        allowed: [...mcp, ...CODE_BASH, ...exactBashRules(commands), ...programBashRules(commands), ...EDIT_TOOLS, "Read", "Glob", "Grep"],
        denied: [],
      };
    case "publish":
      return { allowed: [...mcp, ...PUBLISH_BASH, "Read", "Glob", "Grep"], denied: [...EDIT_DENIED, ...PUBLISH_DENIED] };
    case "run":
      return {
        allowed: [...mcp, ...READ_ONLY_BASH, ...exactBashRules(commands), "Read", "Glob", "Grep"],
        denied: EDIT_DENIED,
      };
    case "read":
      return { allowed: [...mcp, ...READ_ONLY_BASH, "Read", "Glob", "Grep"], denied: EDIT_DENIED };
  }
}

/**
 * Codex's sandbox for a safe-mode job: the read-only roles get the read-only sandbox, the
 * others a workspace-write one, with network access for the roles that install dependencies
 * (code, verify) or push and call `gh` (pr): the workspace-write sandbox has none by default.
 */
export function codexSandboxArgs(role: string): string[] {
  const access = accessOf(role);
  if (access === "read") return ["--sandbox", "read-only"];
  const network = role === "code" || role === "verify" || role === "pr";
  return ["--sandbox", "workspace-write", ...(network ? ["-c", "sandbox_workspace_write.network_access=true"] : [])];
}

/** The MoonlightQ tools a job of `role` may call, under their own names. */
function moonlightqTools(role: string): readonly RunnerMcpTool[] {
  return Object.hasOwn(ROLE_MCP_TOOLS, role) ? ROLE_MCP_TOOLS[role as Role] : COMMON_MCP_TOOLS;
}

/**
 * A Claude Code `Bash(...)` rule as a Copilot CLI `shell(...)` rule: the same command, and
 * `:*` still matches it with any arguments. Copilot splits a rule list on commas, so a
 * command with one gets no rule.
 */
function copilotShellRule(rule: string): string | null {
  const command = rule.match(/^Bash\((.*)\)$/)?.[1];
  return command && !command.includes(",") ? `shell(${command})` : null;
}

/** Programs Copilot CLI tells apart by their first subcommand (`git push`, `gh pr`). */
const SUBCOMMAND_PROGRAMS = new Set(["git", "gh"]);

/**
 * Copilot CLI matches a shell rule on the command's name, never its arguments (`git` and
 * `gh` on their first subcommand), so `shell(pytest -q)` matches nothing. A review or
 * verification gets one rule per program of the project's commands instead, so it can
 * re-run them, with any arguments; shells, `rm` and the like get none.
 */
export function copilotCommandRules(commands: readonly string[]): string[] {
  const rules = new Set<string>();
  for (const line of commands) {
    for (const command of simpleCommands(line)) {
      const words = command.split(" ");
      while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) words.shift();
      const program = words[0];
      if (!program || !/^[\w.+-]+(?:\/[\w.+-]+)*$/.test(program) || program.includes("..")) continue;
      if (NEVER_WIDENED.has(program)) continue;
      const sub = words[1];
      if (!SUBCOMMAND_PROGRAMS.has(program)) rules.add(`shell(${program})`);
      else if (sub && /^[\w-]+$/.test(sub) && !sub.startsWith("-")) rules.add(`shell(${program} ${sub})`);
    }
  }
  return [...rules];
}

/**
 * The permission flags of a safe-mode Copilot CLI job of `role`, the same profile as Claude
 * Code's: the role's MoonlightQ tools (`moonlightq(<tool>)`; the job's MCP config exposes
 * no others, see copilotMcpConfig), its shell rules, and `write` only for the coder. A
 * command with no allow rule is refused, since nobody can approve it in a `-p` run; deny
 * rules win over any allow rule.
 */
export function copilotSafeArgs(role: string, commands: readonly string[] = []): string[] {
  const access = accessOf(role);
  const profile = claudeSafeProfile(role);
  const allowed = [
    ...moonlightqTools(role).map((tool) => `${MCP_SERVER_NAME}(${tool})`),
    ...profile.allowed.map(copilotShellRule),
    ...(access === "edit" ? programBashRules(commands).map(copilotShellRule) : []),
    ...(access === "run" ? copilotCommandRules(commands) : []),
    ...(access === "edit" ? ["write"] : []),
  ];
  const denied = [...(access === "edit" ? [] : ["write"]), ...profile.denied.map(copilotShellRule)];
  const flags = (flag: string, rules: (string | null)[]) =>
    [...new Set(rules.filter((r): r is string => !!r))].map((r) => `${flag}=${r}`);
  return [...flags("--allow-tool", allowed), ...flags("--deny-tool", denied)];
}

/**
 * The job's `--additional-mcp-config` file: the MoonlightQ server in the Copilot CLI's own
 * format (`~/.copilot/mcp-config.json`). Copilot runs some MCP tools without asking, so in
 * safe mode `tools` exposes only the role's own; full mode exposes them all.
 */
export function copilotMcpConfig(mcp: McpServerLaunch, role: string, permissionMode: RunnerPermissionMode): string {
  const tools = permissionMode === "full" ? ["*"] : [...moonlightqTools(role)];
  const server = { type: "local", command: mcp.command, args: mcp.args, env: mcp.env, tools };
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
}

/** A TOML basic string or array of them (JSON's escapes are valid TOML). */
function toml(value: string | string[]): string {
  return Array.isArray(value) ? `[${value.map((v) => JSON.stringify(v)).join(", ")}]` : JSON.stringify(value);
}

/** `-c` overrides that add the MoonlightQ server to Codex's `mcp_servers` for this run. */
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
 * at a copy of the system settings with the MoonlightQ server added. Admin settings in
 * the real file are kept; a file that cannot be read stops the job with a clear error.
 */
export function geminiSettings(mcp: McpServerLaunch, systemPath = geminiSystemSettingsPath()): string {
  let base: Record<string, any> = {};
  if (existsSync(systemPath)) {
    try {
      base = JSON.parse(readFileSync(systemPath, "utf8"));
    } catch (e: any) {
      throw new Error(
        `gemini: cannot add the MoonlightQ MCP server to this run: ${systemPath} is not readable JSON (${e?.message ?? e}). Fix that file and start the runner again.`,
      );
    }
  }
  const { mcpServers } = mcpServersConfig(mcp);
  return JSON.stringify({ ...base, mcpServers: { ...base.mcpServers, ...mcpServers } }, null, 2);
}

/**
 * A runner that executes an argv of its own: the custom tool, or extra arguments
 * on any tool (e.g. an inline `--mcp-config` or a Codex `-c` override can start
 * any command). Anyone who can create one can run commands on this machine.
 */
export function runsCustomArgv(runner: { tool: RunnerTool; extraArgs?: string[] | null }): boolean {
  return runner.tool === "custom" || (runner.extraArgs?.length ?? 0) > 0;
}

/** Custom argv runners are created and run only when the server was started with MOONLIGHTQ_ALLOW_CUSTOM_RUNNERS=1. */
export function customRunnersAllowed(): boolean {
  return process.env.MOONLIGHTQ_ALLOW_CUSTOM_RUNNERS === "1";
}

export const CUSTOM_RUNNERS_DISABLED =
  "Custom runners (tool custom, or extraArgs on any tool) are disabled: start the server with MOONLIGHTQ_ALLOW_CUSTOM_RUNNERS=1 to allow them";

export function buildCommand(tool: RunnerTool, ctx: CommandContext): BuiltCommand {
  const extra = ctx.extraArgs ?? [];
  const model = ctx.model?.trim();
  switch (tool) {
    case "claude": {
      const cmd = ["claude", "-p", ctx.prompt, "--output-format", "json", "--mcp-config", ctx.mcpConfigFile];
      if (ctx.permissionMode === "full") {
        cmd.push("--dangerously-skip-permissions");
      } else {
        const profile = claudeSafeProfile(ctx.role, ctx.commands);
        if (profile.permissionMode) cmd.push("--permission-mode", profile.permissionMode);
        cmd.push("--allowedTools", ...profile.allowed);
        if (profile.denied.length > 0) cmd.push("--disallowedTools", ...profile.denied);
      }
      if (model) cmd.push("--model", model);
      if (ctx.effort) cmd.push("--effort", ctx.effort);
      cmd.push(...extra);
      return { cmd, cwd: ctx.cwd, env: childEnv(ctx) };
    }
    case "codex": {
      const cmd = ["codex", "exec"];
      // `--sandbox` rather than `--full-auto`, which current Codex releases no longer accept.
      cmd.push(...(ctx.permissionMode === "full" ? ["--dangerously-bypass-approvals-and-sandbox"] : codexSandboxArgs(ctx.role)));
      cmd.push("-C", ctx.cwd, "--skip-git-repo-check", ...codexMcpOverrides(ctx.mcp));
      if (ctx.toolWorktree) cmd.push("--worktree");
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
    case "copilot": {
      // `--no-ask-user`: nobody answers a question in a `-p` run, so the agent works it out.
      const mcpFile = ctx.mcpConfigFile.replace(/(\.mcp)?\.json$/, ".copilot-mcp.json");
      const cmd = ["copilot", "-p", ctx.prompt, "--no-ask-user", "--no-color", "--additional-mcp-config", `@${mcpFile}`];
      cmd.push(...(ctx.permissionMode === "full" ? ["--allow-all"] : copilotSafeArgs(ctx.role, ctx.commands)));
      if (model) cmd.push("--model", model);
      if (ctx.effort) cmd.push("--reasoning-effort", ctx.effort);
      cmd.push(...extra);
      return {
        cmd,
        cwd: ctx.cwd,
        env: childEnv(ctx),
        files: [{ path: mcpFile, content: copilotMcpConfig(ctx.mcp, ctx.role, ctx.permissionMode) }],
      };
    }
    case "custom": {
      if (extra.length === 0) {
        throw new Error("custom runners need extraArgs (the full argv to execute)");
      }
      // A custom tool gets the server through $MOONLIGHTQ_MCP_CONFIG (see docs/runner.md).
      return {
        cmd: [...extra, ctx.prompt],
        cwd: ctx.cwd,
        env: childEnv(ctx, { MOONLIGHTQ_PROMPT: ctx.prompt }),
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
    case "copilot":
      return tool;
    case "custom":
      return null;
  }
}
