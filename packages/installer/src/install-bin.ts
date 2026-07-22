import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const INSTALL_DIR = join(homedir(), ".local/bin");
const INSTALL_PATH = join(INSTALL_DIR, "agentq");
const CLI_SOURCE = join(import.meta.dir, "../../cli/src/index.ts");

function log(icon: string, msg: string) {
  console.log(`${icon} ${msg}`);
}

async function installBinary() {
  console.log("");
  log("📦", "Installing AgentQ binary...\n");

  // Step 1: Build the binary
  log("🔨", "Building binary from source...");
  const startTime = Date.now();
  const buildResult = await $`bun build --compile ${CLI_SOURCE} --outfile /tmp/agentq-binary`.quiet();

  if (buildResult.exitCode !== 0) {
    log("❌", "Build failed!");
    console.error(buildResult.stderr.toString());
    process.exit(1);
  }

  const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);
  log("✅", `Binary built successfully (${buildTime}s)`);

  // Step 2: Create install directory if missing
  if (!existsSync(INSTALL_DIR)) {
    log("📁", `Creating install directory: ${INSTALL_DIR}`);
    mkdirSync(INSTALL_DIR, { recursive: true });
    log("✅", "Directory created");
  } else {
    log("📁", `Install directory exists: ${INSTALL_DIR}`);
  }

  // Step 3: Copy binary to install location
  log("📋", `Copying binary to ${INSTALL_PATH}...`);
  await $`cp /tmp/agentq-binary ${INSTALL_PATH}`.quiet();
  log("✅", "Binary copied");

  // Step 4: Make executable
  log("🔧", "Setting executable permissions...");
  await $`chmod 755 ${INSTALL_PATH}`.quiet();
  log("✅", "Permissions set (755)");

  // Step 5: Clean up temp file
  log("🧹", "Cleaning up temporary files...");
  await $`rm -f /tmp/agentq-binary`.quiet();
  log("✅", "Cleanup complete");

  // Step 6: Verify installation
  log("🔍", "Verifying installation...");
  const versionResult = await $`${INSTALL_PATH} --version`.quiet();
  const version = versionResult.stdout.toString().trim();

  // Step 7: Check PATH
  log("🔍", "Checking PATH configuration...");
  const pathCheck = await $`echo $PATH`.quiet();
  const pathDirs = pathCheck.stdout.toString().trim().split(":");
  const inPath = pathDirs.includes(INSTALL_DIR);

  // Summary
  console.log("\n" + "─".repeat(50));
  console.log("📦 INSTALLATION SUMMARY");
  console.log("─".repeat(50));
  console.log(`   ✅ Binary installed to: ${INSTALL_PATH}`);
  console.log(`   ✅ Version: ${version}`);
  console.log(`   ${inPath ? "✅" : "⚠️ "} PATH: ${inPath ? "configured" : "not in PATH"}`);
  console.log("─".repeat(50));

  if (!inPath) {
    console.log("\n⚠️  Action required:");
    console.log(`   Add this to your shell profile (~/.zshrc, ~/.bashrc, etc.):`);
    console.log(`   export PATH="${INSTALL_DIR}:$PATH"\n`);
  } else {
    console.log("\n🎉 AgentQ is ready to use! Try: agentq --help\n");
  }
}

installBinary().catch((err) => {
  log("❌", "Installation failed!");
  console.error(err);
  process.exit(1);
});
