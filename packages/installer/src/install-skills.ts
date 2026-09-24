import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { SKILLS_DIR, SKILL_PREFIX, listSkills, toolSkillDirs } from "@agentq/shared/skills";

const SKILLS_SOURCE_DIR = SKILLS_DIR;

/** Directory names that are leftovers from the old tool name and must be removed. */
const STALE_SKILL_DIRS = ["atq-workflow", "agentq-workflow"];

/**
 * AgentQ skills installed for a tool that the repo no longer ships (renamed or
 * removed). Only `agentq-*` folders are ours; anything else is left alone.
 */
function obsoleteSkills(toolSkillsDir: string, current: string[]): string[] {
  if (!existsSync(toolSkillsDir)) return [];
  return readdirSync(toolSkillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(SKILL_PREFIX))
    .map((entry) => entry.name)
    .filter((name) => !current.includes(name));
}

/**
 * Syncs every skill into each tool's skills directory: copies the repo's skills
 * and removes AgentQ skills the repo dropped. Returns false when there is nothing to copy.
 */
export function installSkills(): boolean {
  const skills = listSkills(SKILLS_SOURCE_DIR);
  if (skills.length === 0) {
    console.log(`❌ No skills found in ${SKILLS_SOURCE_DIR} (expected <skill-name>/SKILL.md)`);
    return false;
  }

  for (const [tool, toolSkillsDir] of Object.entries(toolSkillDirs())) {
    mkdirSync(toolSkillsDir, { recursive: true });
    for (const stale of [...STALE_SKILL_DIRS, ...obsoleteSkills(toolSkillsDir, skills)]) {
      rmSync(join(toolSkillsDir, stale), { recursive: true, force: true });
    }
    // Copy every skill directory recursively (SKILL.md plus any references/*.md etc.)
    for (const skill of skills) {
      cpSync(join(SKILLS_SOURCE_DIR, skill), join(toolSkillsDir, skill), { recursive: true });
    }
    console.log(`✅ ${skills.length} skills installed in ${tool}`);
  }
  return true;
}

if (import.meta.main && !installSkills()) process.exit(1);
