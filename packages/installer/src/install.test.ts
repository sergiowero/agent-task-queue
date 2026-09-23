import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, sep } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerLaunch } from "@agentq/mcp";

// Runs the real `install:all` on the OS the tests run on (CI: Linux, macOS, Windows)
// against a throwaway home folder: the user's own tool configs are never touched.

const INSTALL_ALL = join(import.meta.dir, "install-all.ts");

let sandbox: string;
let home: string;

/** Where VS Code keeps its user profile on this OS. */
function vscodeUserDir(): string {
  if (process.platform === "win32") return join(home, "AppData", "Roaming", "Code", "User");
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Code", "User");
  }
  return join(home, ".config", "Code", "User");
}

function configPaths() {
  return {
    claude: join(home, ".claude.json"),
    codex: join(home, ".codex", "config.toml"),
    opencode: join(home, ".config", "opencode", "opencode.json"),
    gemini: join(home, ".gemini", "settings.json"),
    copilot: join(home, ".copilot", "mcp-config.json"),
    vscode: join(vscodeUserDir(), "mcp.json"),
  };
}

/** Each tool's `agentq` entry, reduced to the launch spec it encodes. */
function registeredLaunches(): Record<string, McpServerLaunch> {
  const p = configPaths();
  const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const plain = ({ command, args, env }: any): McpServerLaunch => ({ command, args, env });
  const opencode = json(p.opencode).mcp.agentq;
  return {
    claude: plain(json(p.claude).mcpServers.agentq),
    codex: plain((Bun.TOML.parse(readFileSync(p.codex, "utf8")) as any).mcp_servers.agentq),
    opencode: {
      command: opencode.command[0],
      args: opencode.command.slice(1),
      env: opencode.environment,
    },
    gemini: plain(json(p.gemini).mcpServers.agentq),
    copilot: plain(json(p.copilot).mcpServers.agentq),
    vscode: plain(json(p.vscode).servers.agentq),
  };
}

function snapshot(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(configPaths()).map(([tool, p]) => [tool, readFileSync(p, "utf8")]),
  );
}

function runInstallAll(args: string[] = []) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home, // homedir() on macOS and Linux
    USERPROFILE: home, // homedir() on Windows
    APPDATA: join(home, "AppData", "Roaming"),
  };
  for (const name of [
    "AGENTQ_DB_PATH",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "COPILOT_HOME",
    "XDG_CONFIG_HOME",
  ]) {
    delete env[name];
  }
  const proc = Bun.spawnSync([process.execPath, "run", INSTALL_ALL, ...args], {
    cwd: sandbox,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString();
  if (proc.exitCode !== 0) console.error(stdout, proc.stderr.toString());
  return { exitCode: proc.exitCode, stdout };
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "agentq-install-"));
  home = join(sandbox, "home");
  // Every tool counts as installed, whatever is on PATH: each one wrote its own files.
  for (const file of [
    join(home, ".claude", "settings.json"),
    join(home, ".codex", "auth.json"),
    join(home, ".config", "opencode", "package.json"),
    join(home, ".gemini", "oauth_creds.json"),
    join(home, ".copilot", "config.json"),
    join(vscodeUserDir(), "settings.json"),
  ]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{}");
  }
});

afterAll(() => {
  try {
    // Windows may hold the SQLite files for a moment after the server exits.
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {}
});

describe(`install:all on ${process.platform}`, () => {
  it("registers the MCP server with every tool and installs the skills", () => {
    const { exitCode, stdout } = runInstallAll();
    expect(exitCode).toBe(0);
    for (const label of [
      "Claude Code",
      "Codex",
      "OpenCode",
      "Gemini CLI",
      "GitHub Copilot CLI",
      "GitHub Copilot (VS Code)",
    ]) {
      expect(stdout).toContain(`✅ MCP server installed in ${label}\n`);
    }

    // The default database, ~/.agentq/agentq.db.
    const dbPath = join(home, ".agentq", "agentq.db");
    for (const [tool, launch] of Object.entries(registeredLaunches())) {
      expect({ tool, dbPath: launch.env.AGENTQ_DB_PATH }).toEqual({ tool, dbPath });
      expect(existsSync(launch.command)).toBe(true);
      expect(existsSync(launch.args[1])).toBe(true);
    }

    for (const dir of [".claude/skills", ".codex/skills", ".config/opencode/skills"]) {
      expect(existsSync(join(home, dir, "agentq-claim", "SKILL.md"))).toBe(true);
    }
  }, 60_000);

  it("changes nothing when run again", () => {
    const before = snapshot();
    const { exitCode, stdout } = runInstallAll();
    expect(exitCode).toBe(0);
    expect(stdout.match(/MCP server already installed in /g)).toHaveLength(6);
    expect(snapshot()).toEqual(before);
  }, 60_000);

  it("starts the registered server the way an MCP client does", async () => {
    // A fresh machine: the server creates ~/.agentq itself.
    expect(existsSync(join(home, ".agentq"))).toBe(false);
    // Only the SDK's default environment plus the entry's env, like Copilot or Claude Code.
    const launch = registeredLaunches().copilot;
    const client = new Client({ name: "install-test", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ ...launch, stderr: "pipe" }));
    try {
      const result = (await client.callTool({
        name: "list_projects",
        arguments: {},
      })) as CallToolResult;
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ success: true, projects: [] });
    } finally {
      await client.close();
    }
    expect(existsSync(join(home, ".agentq", "agentq.db"))).toBe(true);
  }, 60_000);

  it("makes --db absolute: relative to the current folder, ~ expanded", () => {
    expect(runInstallAll(["--db", join("data", "relative.db")]).exitCode).toBe(0);
    let dbPath = registeredLaunches().vscode.env.AGENTQ_DB_PATH;
    expect(isAbsolute(dbPath)).toBe(true);
    expect(dbPath.endsWith(join("data", "relative.db"))).toBe(true);
    // Compare real paths: macOS tmp folders are symlinks, Windows ones may be 8.3 names.
    expect(realpathSync.native(dirname(dirname(dbPath)))).toBe(realpathSync.native(sandbox));

    // `~\x` on Windows (cmd and PowerShell do not expand it), `~/x` elsewhere.
    expect(runInstallAll(["--db", `~${sep}other${sep}agentq.db`]).exitCode).toBe(0);
    dbPath = registeredLaunches().vscode.env.AGENTQ_DB_PATH;
    expect(dbPath).toBe(join(home, "other", "agentq.db"));
  }, 60_000);
});
