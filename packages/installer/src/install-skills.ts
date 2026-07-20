import { copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SKILL_SOURCE = join(import.meta.dir, "../../../skills/atq-workflow/SKILL.md");

const TOOL_PATHS: Record<string, string> = {
  claude: join(homedir(), ".claude/skills/atq-workflow/SKILL.md"),
  opencode: join(homedir(), ".config/opencode/skills/atq-workflow/SKILL.md"),
  codex: join(homedir(), ".codex/skills/atq-workflow/SKILL.md"),
  kimi: join(homedir(), ".kimi-code/skills/atq-workflow/SKILL.md"),
  junie: join(homedir(), ".junie/skills/atq-workflow/SKILL.md"),
};

function installSkills() {
  if (!existsSync(SKILL_SOURCE)) {
    console.error(`Source skill not found: ${SKILL_SOURCE}`);
    process.exit(1);
  }

  const installed: string[] = [];
  const skipped: string[] = [];

  for (const [tool, targetPath] of Object.entries(TOOL_PATHS)) {
    const targetDir = join(targetPath, "..");

    // Check if parent skills directory exists
    const parentDir = join(targetDir, "..");
    if (!existsSync(parentDir)) {
      skipped.push(tool);
      continue;
    }

    // Create atq-workflow directory if missing
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Copy skill file
    copyFileSync(SKILL_SOURCE, targetPath);
    installed.push(tool);
  }

  // Print report
  console.log("\nSkill installation complete!\n");

  if (installed.length > 0) {
    console.log("Installed to:");
    for (const tool of installed) {
      console.log(`  ✓ ${tool}`);
    }
  }

  if (skipped.length > 0) {
    console.log("\nSkipped (tool not installed):");
    for (const tool of skipped) {
      console.log(`  - ${tool}`);
    }
  }

  console.log("");
}

installSkills();
