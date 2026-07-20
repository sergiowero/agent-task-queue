import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const INSTALL_DIR = join(homedir(), ".local/bin");
const INSTALL_PATH = join(INSTALL_DIR, "atq");
const CLI_SOURCE = join(import.meta.dir, "../../cli/src/index.ts");

async function installBinary() {
  console.log("Building atq binary...");

  // Build the binary
  const buildResult = await $`bun build --compile ${CLI_SOURCE} --outfile /tmp/atq-binary`.quiet();

  if (buildResult.exitCode !== 0) {
    console.error("Build failed:", buildResult.stderr.toString());
    process.exit(1);
  }

  // Create install directory if missing
  if (!existsSync(INSTALL_DIR)) {
    console.log(`Creating ${INSTALL_DIR}...`);
    mkdirSync(INSTALL_DIR, { recursive: true });
  }

  // Copy binary to install location
  await $`cp /tmp/atq-binary ${INSTALL_PATH}`.quiet();

  // Make executable
  await $`chmod 755 ${INSTALL_PATH}`.quiet();

  // Clean up temp file
  await $`rm -f /tmp/atq-binary`.quiet();

  // Verify installation
  const versionResult = await $`${INSTALL_PATH} --version`.quiet();
  const version = versionResult.stdout.toString().trim();

  console.log(`\n✓ atq installed to ${INSTALL_PATH}`);
  console.log(`  Version: ${version}`);

  // Check if in PATH
  const pathCheck = await $`echo $PATH`.quiet();
  const pathDirs = pathCheck.stdout.toString().trim().split(":");
  if (!pathDirs.includes(INSTALL_DIR)) {
    console.log(`\n⚠ ${INSTALL_DIR} is not in your PATH.`);
    console.log(`  Add this to your shell profile (~/.zshrc, ~/.bashrc, etc.):`);
    console.log(`  export PATH="${INSTALL_DIR}:$PATH"`);
  }
}

installBinary().catch((err) => {
  console.error("Installation failed:", err);
  process.exit(1);
});
