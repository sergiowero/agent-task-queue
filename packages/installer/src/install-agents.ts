import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const AGENTS_DIR = join(import.meta.dir, "../../../agents/opencode");
const OPCODE_AGENTS_DIR = join(homedir(), ".config/opencode/agents");

function installAgent() {
  console.log("\n🔧 Installing AgentQ fetcher agent for opencode...\n");

  const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));

  if (files.length === 0) {
    console.log("⚠️  No agent files found in agents/opencode/");
    console.log("\n🎉 Nothing to install.\n");
    return;
  }

  if (!existsSync(OPCODE_AGENTS_DIR)) {
    console.log("📁 Creating opencode agents directory...");
    mkdirSync(OPCODE_AGENTS_DIR, { recursive: true });
  }

  let installed = 0;
  for (const file of files) {
    const source = join(AGENTS_DIR, file);
    const target = join(OPCODE_AGENTS_DIR, file);

    copyFileSync(source, target);
    console.log(`✅ ${file} installed`);
    installed++;
  }

  console.log(`\n📦 ${installed} agent file(s) installed`);
  console.log("🎉 Agent installation complete!\n");
}

installAgent();
