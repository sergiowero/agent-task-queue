/**
 * Where the coding tools keep their config, as the tools themselves resolve it:
 * an environment variable moves the folder, else it sits under the home folder.
 * The installer writes the MCP registration and the skills to these, and the
 * server reads the installed skills' versions from them.
 */
import { homedir } from "os";
import { join } from "path";

/** The variables that move a tool's config folder (`process.env`, or a test's). */
export type ToolEnv = Record<string, string | undefined>;

/** Claude Code's config folder: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function claudeHome(env: ToolEnv = process.env, home: string = homedir()): string {
  return env.CLAUDE_CONFIG_DIR || join(home, ".claude");
}

/** Codex's home: `$CODEX_HOME`, else `~/.codex`. */
export function codexHome(env: ToolEnv = process.env, home: string = homedir()): string {
  return env.CODEX_HOME || join(home, ".codex");
}

/** The XDG config folder: `$XDG_CONFIG_HOME`, else `~/.config`. */
export function xdgConfigHome(env: ToolEnv = process.env, home: string = homedir()): string {
  return env.XDG_CONFIG_HOME || join(home, ".config");
}

/** OpenCode's config folder, `<xdg config>/opencode`. */
export function opencodeHome(env: ToolEnv = process.env, home: string = homedir()): string {
  return join(xdgConfigHome(env, home), "opencode");
}
