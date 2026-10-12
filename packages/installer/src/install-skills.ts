import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { SKILLS_DIR, SKILL_PREFIX, listSkills, toolSkillDirs } from "@moonlightq/shared/skills";
import { claudeHome, codexHome, opencodeHome, type ToolEnv } from "@moonlightq/shared/tool-paths";
import { hasToolData } from "./mcp-setup.js";

/**
 * The tools that load skills from a folder of their own, keyed like `toolSkillDirs`:
 * the binary that says the tool is installed, and the folder it keeps its own data in.
 * Gemini CLI and Copilot have no skills folder here (they read the skills with the
 * `get_skill` MCP tool); Kimi Code and Junie have no MCP registration (see README).
 */
export const SKILL_TOOLS: Record<string, { binary: string; home(env: ToolEnv, home: string): string }> = {
  claude: { binary: "claude", home: claudeHome },
  opencode: { binary: "opencode", home: opencodeHome },
  codex: { binary: "codex", home: codexHome },
  kimi: { binary: "kimi", home: (_env, home) => join(home, ".kimi-code") },
  junie: { binary: "junie", home: (_env, home) => join(home, ".junie") },
};

export interface SkillsEnv {
  homeDir: string;
  /** CLAUDE_CONFIG_DIR, CODEX_HOME and XDG_CONFIG_HOME move the skills folders. */
  env: ToolEnv;
  /** Path of a binary on PATH, or null. */
  which: (bin: string) => string | null;
}

/**
 * MoonlightQ skills installed for a tool that the repo no longer ships (renamed or
 * removed). Only `moonlightq-*` folders are ours; anything else is left alone.
 */
function obsoleteSkills(toolSkillsDir: string, current: string[]): string[] {
  if (!existsSync(toolSkillsDir)) return [];
  return readdirSync(toolSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(SKILL_PREFIX))
    .map((entry) => entry.name)
    .filter((name) => !current.includes(name));
}

/**
 * Whether a tool is on this machine: its binary is on PATH, its own folder holds
 * something the tool wrote, or its skills folder exists (an earlier install put
 * copies there, and they keep being refreshed). A tool that is not here gets no
 * skills folder.
 */
export function skillToolPresent(tool: string, e: SkillsEnv): boolean {
  const spec = SKILL_TOOLS[tool];
  if (!spec) return false;
  return (
    !!e.which(spec.binary) ||
    hasToolData(spec.home(e.env, e.homeDir)) ||
    existsSync(toolSkillDirs(e.env, e.homeDir)[tool])
  );
}

/**
 * Syncs every skill into the skills directory of each tool found on this machine:
 * replaces the repo's skills (each folder as a whole, so a file a skill dropped does
 * not linger) and removes MoonlightQ skills the repo dropped. Returns false when there
 * is nothing to copy.
 */
export function installSkills(
  e: SkillsEnv = { homeDir: homedir(), env: process.env, which: Bun.which },
  source: string = SKILLS_DIR,
  log: (line: string) => void = console.log,
): boolean {
  const skills = listSkills(source);
  if (skills.length === 0) {
    log(`❌ No skills found in ${source} (expected <skill-name>/SKILL.md)`);
    return false;
  }

  let installed = 0;
  for (const [tool, toolSkillsDir] of Object.entries(toolSkillDirs(e.env, e.homeDir))) {
    if (!skillToolPresent(tool, e)) {
      log(`⏭️  Skills not installed in ${tool}: not found on this machine`);
      continue;
    }
    mkdirSync(toolSkillsDir, { recursive: true });
    for (const stale of obsoleteSkills(toolSkillsDir, skills)) {
      rmSync(join(toolSkillsDir, stale), { recursive: true, force: true });
    }
    // Copy every skill directory recursively (SKILL.md plus any references/*.md etc.).
    // The folder is ours (moonlightq-*): it is replaced, not merged into.
    for (const skill of skills) {
      const dest = join(toolSkillsDir, skill);
      rmSync(dest, { recursive: true, force: true });
      cpSync(join(source, skill), dest, { recursive: true });
    }
    installed++;
    log(`✅ ${skills.length} skills installed in ${tool} (${toolSkillsDir})`);
  }
  if (installed === 0) {
    log(`⚠️  No coding tool with a skills folder found (${Object.keys(SKILL_TOOLS).join(", ")})`);
  }
  return true;
}

if (import.meta.main && !installSkills()) process.exit(1);
