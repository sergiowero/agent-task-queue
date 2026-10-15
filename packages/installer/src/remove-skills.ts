import { existsSync, readdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { SKILL_PREFIX, toolSkillDirs } from "@moonlightq/shared/skills";
import type { ToolEnv } from "@moonlightq/shared/tool-paths";

export interface SkillsEnv {
  homeDir: string;
  /** CLAUDE_CONFIG_DIR, CODEX_HOME, COPILOT_HOME and XDG_CONFIG_HOME move the skills folders. */
  env: ToolEnv;
}

/**
 * The MoonlightQ MCP server ships the skills (get_skill, phaseSkill.body), so earlier
 * releases' installed copies only go stale. Removes every `moonlightq-*` folder from
 * each tool's skills folder; anything else there is left alone, and no folder is made.
 */
export function removeSkills(
  e: SkillsEnv = { homeDir: homedir(), env: process.env },
  log: (line: string) => void = console.log,
): boolean {
  for (const [tool, dir] of Object.entries(toolSkillDirs(e.env, e.homeDir))) {
    if (!existsSync(dir)) continue;
    const ours = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith(SKILL_PREFIX) && (entry.isDirectory() || entry.isSymbolicLink()))
      .map((entry) => entry.name);
    // rmSync removes a link itself, never what it points to.
    for (const name of ours) rmSync(join(dir, name), { recursive: true, force: true });
    if (ours.length > 0) log(`🧹 ${ours.length} old MoonlightQ skills removed from ${tool} (${dir})`);
  }
  return true;
}

if (import.meta.main) removeSkills();
