import { homedir } from "os";
import { join } from "path";
import { claudeHome, codexHome, copilotHome, opencodeHome, type ToolEnv } from "./tool-paths.js";

// The MoonlightQ MCP server ships the skills (packages/mcp/src/phases). What is left
// here helps the installer remove the copies earlier releases put in each tool.

/** Every MoonlightQ skill folder starts with this; the installer owns folders with this prefix. */
export const SKILL_PREFIX = "moonlightq-";

/**
 * Where each coding tool looks for skills (resolved at call time, so HOME and the
 * tools' own variables apply): Claude Code under `$CLAUDE_CONFIG_DIR`, Codex under
 * `$CODEX_HOME`, OpenCode under `$XDG_CONFIG_HOME`, Copilot CLI under `$COPILOT_HOME`:
 * the folders the MCP registration goes to.
 */
export function toolSkillDirs(env: ToolEnv = process.env, home: string = homedir()): Record<string, string> {
  return {
    claude: join(claudeHome(env, home), "skills"),
    opencode: join(opencodeHome(env, home), "skills"),
    codex: join(codexHome(env, home), "skills"),
    copilot: join(copilotHome(env, home), "skills"),
    kimi: join(home, ".kimi-code/skills"),
    junie: join(home, ".junie/skills"),
  };
}

/** Semver-ish comparison of dotted numeric versions: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
