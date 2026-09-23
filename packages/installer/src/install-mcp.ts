import { homedir } from "os";
import { delimiter, resolve } from "path";
import { mcpServerLaunch } from "@agentq/mcp";
import { getDbPath } from "@agentq/shared";
import { manualEntry, registerAll } from "./mcp-setup.js";

/**
 * Registers the AgentQ MCP server with every installed coding tool (Claude Code,
 * Codex, OpenCode, Gemini CLI, GitHub Copilot CLI and GitHub Copilot in VS Code).
 * Safe to run again: up-to-date entries are left alone.
 *
 *   bun run install:mcp              # database from AGENTQ_DB_PATH, default ~/.agentq/agentq.db
 *   bun run install:mcp --db <path>  # another database
 */

/** `~` at the start of a path; Windows shells (cmd, PowerShell) leave `~\x` unexpanded. */
const HOME_PREFIX = process.platform === "win32" ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/;

/**
 * The database path the tools get: always absolute, since each tool starts the
 * server from its own working directory.
 */
function dbPathFromArgs(argv: string[]): string | null {
  const i = argv.indexOf("--db");
  const value = i === -1 ? getDbPath() : argv[i + 1];
  if (!value) return null;
  return resolve(value.replace(HOME_PREFIX, () => homedir()));
}

/**
 * The `bun` the tools should start: the one on PATH (a stable location such as
 * ~/.bun/bin or /opt/homebrew/bin), skipping the temporary `bun-node-*` shim
 * directory `bun run` puts in front of PATH; else the running executable.
 */
function stableBunPath(): string {
  const PATH = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => dir && !/bun-node-/.test(dir))
    .join(delimiter);
  return Bun.which("bun", { PATH }) ?? process.execPath;
}

/** Returns false when a tool could not be set up (its manual step is printed). */
export function installMcp(argv: string[] = []): boolean {
  const dbPath = dbPathFromArgs(argv);
  if (!dbPath) {
    console.log("❌ --db needs a path");
    return false;
  }
  const launch = mcpServerLaunch(dbPath, stableBunPath());
  const results = registerAll(launch, {
    homeDir: homedir(),
    platform: process.platform,
    env: process.env,
    which: Bun.which,
  });

  let ok = true;
  for (const r of results) {
    if (r.status === "added" || r.status === "updated") {
      console.log(`✅ MCP server installed in ${r.label}`);
    } else if (r.status === "unchanged") {
      console.log(`✅ MCP server already installed in ${r.label}`);
    } else if (r.status === "failed") {
      ok = false;
      console.log(`❌ MCP server not installed in ${r.label}: ${r.message}`);
      console.log(`   Add this to ${r.configPath} by hand:\n${manualEntry(r.tool, launch)}`);
    }
  }
  if (results.every((r) => r.status === "not_installed")) {
    console.log(
      "⚠️  No coding tool found for the MCP server (claude, codex, opencode, gemini, copilot, code)",
    );
  }
  return ok;
}

if (import.meta.main && !installMcp(process.argv.slice(2))) process.exit(1);
