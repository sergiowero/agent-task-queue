import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SKILLS_SOURCE_DIR = join(import.meta.dir, "../../../skills");

/** Directory names that are leftovers from the old tool name and must be removed. */
const STALE_SKILL_DIRS = ["atq-workflow", "agentq-workflow"];

const TOOL_SKILL_DIRS: Record<string, string> = {
  claude: join(homedir(), ".claude/skills"),
  opencode: join(homedir(), ".config/opencode/skills"),
  codex: join(homedir(), ".codex/skills"),
  kimi: join(homedir(), ".kimi-code/skills"),
  junie: join(homedir(), ".junie/skills"),
};

/** Every directory under `skills/` that contains a SKILL.md, e.g. ["agentq-claim", "agentq-plan", ...]. */
function discoverSkills(): string[] {
  return readdirSync(SKILLS_SOURCE_DIR, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(SKILLS_SOURCE_DIR, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
}

/** Copies every skill into each tool's skills directory. Returns false when there is nothing to copy. */
export function installSkills(): boolean {
  const skills = existsSync(SKILLS_SOURCE_DIR) ? discoverSkills() : [];
  if (skills.length === 0) {
    console.log(`❌ No skills found in ${SKILLS_SOURCE_DIR} (expected <skill-name>/SKILL.md)`);
    return false;
  }

  for (const [tool, toolSkillsDir] of Object.entries(TOOL_SKILL_DIRS)) {
    mkdirSync(toolSkillsDir, { recursive: true });
    for (const stale of STALE_SKILL_DIRS) {
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
