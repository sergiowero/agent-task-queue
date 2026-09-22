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

function log(icon: string, msg: string) {
  console.log(`${icon} ${msg}`);
}

/** Every directory under `skills/` that contains a SKILL.md, e.g. ["agentq-claim", "agentq-plan", ...]. */
function discoverSkills(): string[] {
  return readdirSync(SKILLS_SOURCE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_SOURCE_DIR, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function removeStaleSkills(tool: string, toolSkillsDir: string) {
  for (const stale of STALE_SKILL_DIRS) {
    const staleDir = join(toolSkillsDir, stale);
    if (existsSync(staleDir)) {
      log("🧹", `Removing stale ${stale} directory from ${tool}...`);
      rmSync(staleDir, { recursive: true, force: true });
    }
  }
}

function installSkills() {
  console.log("");
  log("🧠", "Installing AgentQ workflow skills...\n");

  // Step 1: Verify source exists and discover skills
  log("🔍", "Checking skill source directory...");
  if (!existsSync(SKILLS_SOURCE_DIR)) {
    log("❌", `Source skills directory not found: ${SKILLS_SOURCE_DIR}`);
    process.exit(1);
  }

  const skills = discoverSkills();
  if (skills.length === 0) {
    log("❌", `No skills found in ${SKILLS_SOURCE_DIR} (expected <skill-name>/SKILL.md)`);
    process.exit(1);
  }
  log("✅", `Source found: ${SKILLS_SOURCE_DIR}`);
  log("📚", `Skills to install: ${skills.join(", ")}`);

  // Step 2: Install to each tool
  console.log("");
  log("📥", "Installing skills to detected tools...\n");

  const installed: string[] = [];
  const skipped: string[] = [];

  for (const [tool, toolSkillsDir] of Object.entries(TOOL_SKILL_DIRS)) {
    // Create the tool's skills directory if missing
    if (!existsSync(toolSkillsDir)) {
      log("📁", `Creating skills directory for ${tool}...`);
      mkdirSync(toolSkillsDir, { recursive: true });
    }

    removeStaleSkills(tool, toolSkillsDir);

    // Copy every skill directory recursively (SKILL.md plus any references/*.md etc.)
    log("📋", `Installing to ${tool}...`);
    for (const skill of skills) {
      const source = join(SKILLS_SOURCE_DIR, skill);
      const target = join(toolSkillsDir, skill);
      cpSync(source, target, { recursive: true });
    }
    installed.push(tool);
    log("✅", `${tool}: ${skills.length} skill(s) installed`);
  }

  // Summary
  console.log("\n" + "─".repeat(50));
  console.log("🧠 SKILL INSTALLATION SUMMARY");
  console.log("─".repeat(50));

  if (installed.length > 0) {
    console.log(`   ✅ Installed ${skills.length} skill(s) to ${installed.length} tool(s):`);
    for (const tool of installed) {
      console.log(`      • ${tool} → ${TOOL_SKILL_DIRS[tool]}`);
    }
    console.log(`\n   📚 Skills:`);
    for (const skill of skills) {
      console.log(`      • ${skill}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n   ⚠️  Skipped ${skipped.length} tool(s) (not installed):`);
    for (const tool of skipped) {
      console.log(`      • ${tool}`);
    }
  }

  console.log("─".repeat(50));
  console.log("\n🎉 Skills installation complete!\n");
}

installSkills();
