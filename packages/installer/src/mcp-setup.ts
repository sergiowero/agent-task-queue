import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { McpServerLaunch } from "@agentq/mcp";
import { MCP_SERVER_NAME } from "@agentq/mcp";

/**
 * Registers the AgentQ MCP server in the user-level config of every installed
 * coding tool. Each tool's config file is edited in place: only the `agentq`
 * entry is added or replaced, everything else is kept, and a file whose entry
 * is already up to date is not rewritten, so running it again is a no-op.
 */

export type SetupTool = "claude" | "codex" | "opencode" | "gemini" | "copilot" | "vscode";

export interface SetupEnv {
  homeDir: string;
  /** Picks the VS Code user folder (Windows: %APPDATA%, macOS: ~/Library/Application Support). */
  platform: NodeJS.Platform;
  /**
   * Variables that move config files: CLAUDE_CONFIG_DIR, CODEX_HOME, COPILOT_HOME,
   * XDG_CONFIG_HOME, APPDATA.
   */
  env: Record<string, string | undefined>;
  /** Path of a binary on PATH, or null. */
  which: (bin: string) => string | null;
}

export type SetupStatus = "added" | "updated" | "unchanged" | "not_installed" | "failed";

export interface SetupResult {
  tool: SetupTool;
  label: string;
  status: SetupStatus;
  configPath: string;
  message?: string;
}

interface ToolTarget {
  tool: SetupTool;
  label: string;
  binary: string;
  configPath(e: SetupEnv): string;
  /** Exists when the tool was set up on this machine, even if its binary is not on PATH. */
  homeMarker(e: SetupEnv): string;
  /** JSON configs: the key that holds the servers. Absent for Codex's TOML. */
  section?: string;
  /** The `agentq` entry this tool should hold. */
  entry(launch: McpServerLaunch): unknown;
  /** The `agentq` entry currently in `content` (undefined when absent). Throws on unreadable content. */
  read(content: string | null): unknown;
  /** `content` with the `agentq` entry set to `entry`. */
  write(content: string | null, entry: unknown): string;
}

// ─── JSON configs ──────────────────────────────────────────────────────

function parseJsonObject(content: string | null): Record<string, any> {
  if (content === null || content.trim() === "") return {};
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the file does not hold a JSON object");
  }
  return parsed;
}

/** A JSON config whose servers live under `root[section][name]`. */
function jsonTarget(
  base: Omit<ToolTarget, "read" | "write">,
  section: string,
  seed: Record<string, unknown> = {},
): ToolTarget {
  return {
    ...base,
    section,
    read(content) {
      return parseJsonObject(content)[section]?.[MCP_SERVER_NAME];
    },
    write(content, entry) {
      const root = content === null ? { ...seed } : parseJsonObject(content);
      const servers = root[section] && typeof root[section] === "object" ? root[section] : {};
      root[section] = { ...servers, [MCP_SERVER_NAME]: entry };
      return JSON.stringify(root, null, 2) + "\n";
    },
  };
}

// ─── Codex TOML ────────────────────────────────────────────────────────

/** `a."b".c` → ["a", "b", "c"] (enough for table headers). */
function tomlKeyPath(key: string): string[] {
  const parts: string[] = [];
  const re = /\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*(?:\.|$)/y;
  let match: RegExpExecArray | null;
  while (re.lastIndex < key.length && (match = re.exec(key))) {
    const raw = match[1];
    parts.push(
      raw.startsWith('"') ? JSON.parse(raw) : raw.startsWith("'") ? raw.slice(1, -1) : raw,
    );
  }
  return parts;
}

const TOML_HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;

/** Removes the `[mcp_servers.agentq]` table and its sub-tables. */
function removeCodexServer(content: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of content.split(/\r?\n/)) {
    const header = line.match(TOML_HEADER);
    if (header) {
      const path = tomlKeyPath(header[1]);
      skipping = path[0] === "mcp_servers" && path[1] === MCP_SERVER_NAME;
    }
    if (!skipping) out.push(line);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

const tomlString = (value: string) => JSON.stringify(value);

const codexTarget: ToolTarget = {
  tool: "codex",
  label: "Codex",
  binary: "codex",
  configPath: (e) => join(e.env.CODEX_HOME || join(e.homeDir, ".codex"), "config.toml"),
  homeMarker: (e) => e.env.CODEX_HOME || join(e.homeDir, ".codex"),
  entry: (launch) => ({ command: launch.command, args: launch.args, env: launch.env }),
  read(content) {
    if (!content) return undefined;
    const server = (Bun.TOML.parse(content) as any).mcp_servers?.[MCP_SERVER_NAME];
    return server ? { command: server.command, args: server.args, env: server.env } : undefined;
  },
  write(content, entry) {
    const { command, args, env } = entry as McpServerLaunch;
    const rest = content ? removeCodexServer(content) : "";
    if (rest && (Bun.TOML.parse(rest) as any).mcp_servers?.[MCP_SERVER_NAME]) {
      throw new Error(
        `mcp_servers.${MCP_SERVER_NAME} is defined inline; replace it with the block below by hand`,
      );
    }
    const block = [
      `[mcp_servers.${MCP_SERVER_NAME}]`,
      `command = ${tomlString(command)}`,
      `args = [${args.map(tomlString).join(", ")}]`,
      "",
      `[mcp_servers.${MCP_SERVER_NAME}.env]`,
      ...Object.entries(env).map(([k, v]) => `${k} = ${tomlString(v)}`),
    ].join("\n");
    return (rest ? `${rest}\n\n` : "") + block + "\n";
  },
};

// ─── Targets ───────────────────────────────────────────────────────────

function claudeDir(e: SetupEnv): string {
  return e.env.CLAUDE_CONFIG_DIR || e.homeDir;
}

function xdgConfigHome(e: SetupEnv): string {
  return e.env.XDG_CONFIG_HOME || join(e.homeDir, ".config");
}

function opencodeDir(e: SetupEnv): string {
  return join(xdgConfigHome(e), "opencode");
}

function copilotDir(e: SetupEnv): string {
  return e.env.COPILOT_HOME || join(e.homeDir, ".copilot");
}

/** VS Code's user profile folder, where its user-level mcp.json lives. */
function vscodeUserDir(e: SetupEnv): string {
  if (e.platform === "win32") {
    return join(e.env.APPDATA || join(e.homeDir, "AppData", "Roaming"), "Code", "User");
  }
  if (e.platform === "darwin") {
    return join(e.homeDir, "Library", "Application Support", "Code", "User");
  }
  return join(xdgConfigHome(e), "Code", "User");
}

export const TARGETS: ToolTarget[] = [
  jsonTarget(
    {
      tool: "claude",
      label: "Claude Code",
      binary: "claude",
      // User-scoped servers live in ~/.claude.json (or $CLAUDE_CONFIG_DIR/.claude.json).
      configPath: (e) => join(claudeDir(e), ".claude.json"),
      homeMarker: (e) =>
        e.env.CLAUDE_CONFIG_DIR ? e.env.CLAUDE_CONFIG_DIR : join(e.homeDir, ".claude"),
      entry: (launch) => ({
        type: "stdio",
        command: launch.command,
        args: launch.args,
        env: launch.env,
      }),
    },
    "mcpServers",
  ),
  codexTarget,
  jsonTarget(
    {
      tool: "opencode",
      label: "OpenCode",
      binary: "opencode",
      configPath(e) {
        const dir = opencodeDir(e);
        const json = join(dir, "opencode.json");
        const jsonc = join(dir, "opencode.jsonc");
        return !existsSync(json) && existsSync(jsonc) ? jsonc : json;
      },
      homeMarker: opencodeDir,
      entry: (launch) => ({
        type: "local",
        command: [launch.command, ...launch.args],
        environment: launch.env,
        enabled: true,
      }),
    },
    "mcp",
    { $schema: "https://opencode.ai/config.json" },
  ),
  jsonTarget(
    {
      tool: "gemini",
      label: "Gemini CLI",
      binary: "gemini",
      configPath: (e) => join(e.homeDir, ".gemini", "settings.json"),
      homeMarker: (e) => join(e.homeDir, ".gemini"),
      entry: (launch) => ({ command: launch.command, args: launch.args, env: launch.env }),
    },
    "mcpServers",
  ),
  jsonTarget(
    {
      tool: "copilot",
      label: "GitHub Copilot CLI",
      binary: "copilot",
      configPath: (e) => join(copilotDir(e), "mcp-config.json"),
      homeMarker: copilotDir,
      entry: (launch) => ({
        type: "local",
        command: launch.command,
        args: launch.args,
        env: launch.env,
        tools: ["*"],
      }),
    },
    "mcpServers",
  ),
  jsonTarget(
    {
      tool: "vscode",
      label: "GitHub Copilot (VS Code)",
      binary: "code",
      // The user-level mcp.json of the default profile ("MCP: Open User Configuration").
      configPath: (e) => join(vscodeUserDir(e), "mcp.json"),
      homeMarker: vscodeUserDir,
      entry: (launch) => ({
        type: "stdio",
        command: launch.command,
        args: launch.args,
        env: launch.env,
      }),
    },
    "servers",
  ),
];

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Folders our own installers create inside a tool's home (install:skills). */
const AGENTQ_ONLY_ENTRIES = new Set(["skills"]);

/** The tool's home exists and holds something the tool itself wrote. */
function hasToolData(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((name) => !AGENTQ_ONLY_ENTRIES.has(name));
  } catch {
    return false;
  }
}

export function isInstalled(target: ToolTarget, e: SetupEnv): boolean {
  return !!e.which(target.binary) || hasToolData(target.homeMarker(e));
}

/** Registers `launch` with one tool. Never throws: problems come back as `failed`. */
export function registerWith(
  target: ToolTarget,
  launch: McpServerLaunch,
  e: SetupEnv,
): SetupResult {
  const configPath = target.configPath(e);
  const result = (status: SetupStatus, message?: string): SetupResult => ({
    tool: target.tool,
    label: target.label,
    status,
    configPath,
    ...(message ? { message } : {}),
  });
  if (!isInstalled(target, e)) return result("not_installed");

  const desired = target.entry(launch);
  try {
    // Windows editors (and PowerShell 5.1's Set-Content/Out-File) may save a UTF-8
    // BOM, which JSON.parse rejects. It is dropped when the file is rewritten.
    const content = existsSync(configPath)
      ? readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")
      : null;
    const current = target.read(content);
    if (sameJson(current, desired)) return result("unchanged");

    const next = target.write(content, desired);
    if (!sameJson(target.read(next), desired)) {
      throw new Error("the updated file did not read back as expected; it was left untouched");
    }
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, next);
    return result(current === undefined ? "added" : "updated");
  } catch (error) {
    return result("failed", error instanceof Error ? error.message : String(error));
  }
}

export function registerAll(launch: McpServerLaunch, e: SetupEnv): SetupResult[] {
  return TARGETS.map((target) => registerWith(target, launch, e));
}

/** The entry to paste by hand when a config file could not be edited. */
export function manualEntry(tool: SetupTool, launch: McpServerLaunch): string {
  const target = TARGETS.find((t) => t.tool === tool)!;
  const entry = target.entry(launch);
  if (!target.section) return target.write(null, entry).trimEnd();
  return JSON.stringify({ [target.section]: { [MCP_SERVER_NAME]: entry } }, null, 2);
}
