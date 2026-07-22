import { copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SKILL_SOURCE = join(import.meta.dir, "../../../skills/agentq-workflow/SKILL.md");

const TOOL_PATHS: Record<string, string> = {
  claude: join(homedir(), ".claude/skills/agentq-workflow/SKILL.md"),
  opencode: join(homedir(), ".config/opencode/skills/agentq-workflow/SKILL.md"),
  codex: join(homedir(), ".codex/skills/agentq-workflow/SKILL.md"),
  kimi: join(homedir(), ".kimi-code/skills/agentq-workflow/SKILL.md"),
  junie: join(homedir(), ".junie/skills/agentq-workflow/SKILL.md"),
};

function log(icon: string, msg: string) {
  console.log(`${icon} ${msg}`);
}

function installSkills() {
  console.log("");
  log("🧠", "Installing AgentQ workflow skills...\n");

  // Step 1: Verify source exists
  log("🔍", "Checking skill source file...");
  if (!existsSync(SKILL_SOURCE)) {
    log("❌", `Source skill not found: ${SKILL_SOURCE}`);
    process.exit(1);
  }
  log("✅", `Source found: ${SKILL_SOURCE}`);

  // Step 2: Install to each tool
  console.log("");
  log("📥", "Installing skills to detected tools...\n");

  const installed: string[] = [];
  const skipped: string[] = [];

  for (const [tool, targetPath] of Object.entries(TOOL_PATHS)) {
    const targetDir = join(targetPath, "..");

    // Create agentq-workflow directory if missing
    if (!existsSync(targetDir)) {
      log("📁", `Creating directory for ${tool}...`);
      mkdirSync(targetDir, { recursive: true });
    }

    // Copy skill file
    log("📋", `Installing to ${tool}...`);
    copyFileSync(SKILL_SOURCE, targetPath);
    installed.push(tool);
    log("✅", `${tool} skill installed`);
  }

  // Summary
  console.log("\n" + "─".repeat(50));
  console.log("🧠 SKILL INSTALLATION SUMMARY");
  console.log("─".repeat(50));

  if (installed.length > 0) {
    console.log(`   ✅ Installed to ${installed.length} tool(s):`);
    for (const tool of installed) {
      console.log(`      • ${tool}`);
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
