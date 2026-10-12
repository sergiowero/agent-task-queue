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
import type { McpServerLaunch } from "@mtq/mcp";
import { skillVersion, skillsBundleVersion } from "@mtq/shared/skills";

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

/** Each tool's `mtq` entry, reduced to the launch spec it encodes. */
function registeredLaunches(): Record<string, McpServerLaunch> {
  const p = configPaths();
  const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const plain = ({ command, args, env }: any): McpServerLaunch => ({ command, args, env });
  const opencode = json(p.opencode).mcp.mtq;
  return {
    claude: plain(json(p.claude).mcpServers.mtq),
    codex: plain((Bun.TOML.parse(readFileSync(p.codex, "utf8")) as any).mcp_servers.mtq),
    opencode: {
      command: opencode.command[0],
      args: opencode.command.slice(1),
      env: opencode.environment,
    },
    gemini: plain(json(p.gemini).mcpServers.mtq),
    copilot: plain(json(p.copilot).mcpServers.mtq),
    vscode: plain(json(p.vscode).servers.mtq),
  };
}

function snapshot(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(configPaths()).map(([tool, p]) => [tool, readFileSync(p, "utf8")]),
  );
}

/**
 * `extra` sets more variables (undefined removes one) and `at` runs it against another
 * throwaway home. `noTools` empties PATH, so only the folders a tool wrote count as installed.
 */
function runInstallAll(
  args: string[] = [],
  extra: { at?: string; env?: Record<string, string | undefined>; noTools?: boolean } = {},
) {
  const h = extra.at ?? home;
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: h, // homedir() on macOS and Linux
    USERPROFILE: h, // homedir() on Windows
    APPDATA: join(h, "AppData", "Roaming"),
  };
  for (const name of [
    "MTQ_DB_PATH",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "COPILOT_HOME",
    "XDG_CONFIG_HOME",
  ]) {
    delete env[name];
  }
  if (extra.noTools) {
    for (const name of Object.keys(env)) if (name.toUpperCase() === "PATH") delete env[name];
    env.PATH = join(sandbox, "no-tools");
  }
  Object.assign(env, extra.env);
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
  sandbox = mkdtempSync(join(tmpdir(), "mtq-install-"));
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

    // The default database, ~/.mtq/mtq.db.
    const dbPath = join(home, ".mtq", "mtq.db");
    for (const [tool, launch] of Object.entries(registeredLaunches())) {
      expect({ tool, dbPath: launch.env.MTQ_DB_PATH }).toEqual({ tool, dbPath });
      expect(existsSync(launch.command)).toBe(true);
      expect(existsSync(launch.args[1])).toBe(true);
    }

    for (const dir of [".claude/skills", ".codex/skills", ".config/opencode/skills"]) {
      expect(existsSync(join(home, dir, "mtq-claim", "SKILL.md"))).toBe(true);
    }
  }, 60_000);

  it("changes nothing when run again", () => {
    const before = snapshot();
    const { exitCode, stdout } = runInstallAll();
    expect(exitCode).toBe(0);
    expect(stdout.match(/MCP server already installed in /g)).toHaveLength(6);
    expect(snapshot()).toEqual(before);
  }, 60_000);

  it("removes Moonlight Task Queue skills the repo no longer ships and leaves other skills alone", () => {
    const skills = join(home, ".claude", "skills");
    mkdirSync(join(skills, "mtq-retired"), { recursive: true });
    writeFileSync(join(skills, "mtq-retired", "SKILL.md"), "old");
    // Renamed to agentq-pr in 5.0.0, then to mtq-pr.
    mkdirSync(join(skills, "agentq-merge"), { recursive: true });
    writeFileSync(join(skills, "agentq-merge", "SKILL.md"), "old");
    mkdirSync(join(skills, "someone-elses-skill"), { recursive: true });
    writeFileSync(join(skills, "someone-elses-skill", "SKILL.md"), "keep me");

    expect(runInstallAll().exitCode).toBe(0);
    expect(existsSync(join(skills, "mtq-retired"))).toBe(false);
    expect(existsSync(join(skills, "agentq-merge"))).toBe(false);
    expect(existsSync(join(skills, "mtq-pr", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skills, "someone-elses-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skills, "mtq-claim", "SKILL.md"))).toBe(true);
    rmSync(join(skills, "someone-elses-skill"), { recursive: true, force: true });
  }, 60_000);

  it("starts the registered server the way an MCP client does", async () => {
    // A fresh machine: the server creates ~/.mtq itself.
    expect(existsSync(join(home, ".mtq"))).toBe(false);
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
    expect(existsSync(join(home, ".mtq", "mtq.db"))).toBe(true);
  }, 60_000);

  it("makes --db absolute: relative to the current folder, ~ expanded", () => {
    expect(runInstallAll(["--db", join("data", "relative.db")]).exitCode).toBe(0);
    let dbPath = registeredLaunches().vscode.env.MTQ_DB_PATH;
    expect(isAbsolute(dbPath)).toBe(true);
    expect(dbPath.endsWith(join("data", "relative.db"))).toBe(true);
    // Compare real paths: macOS tmp folders are symlinks, Windows ones may be 8.3 names.
    expect(realpathSync.native(dirname(dirname(dbPath)))).toBe(realpathSync.native(sandbox));

    // `~\x` on Windows (cmd and PowerShell do not expand it), `~/x` elsewhere.
    expect(runInstallAll(["--db", `~${sep}other${sep}mtq.db`]).exitCode).toBe(0);
    dbPath = registeredLaunches().vscode.env.MTQ_DB_PATH;
    expect(dbPath).toBe(join(home, "other", "mtq.db"));
  }, 60_000);

  it("replaces an installed skill folder as a whole, so a file the skill dropped is gone", () => {
    const skill = join(home, ".claude", "skills", "mtq-code");
    writeFileSync(join(skill, "stale.md"), "from an older bundle");
    mkdirSync(join(skill, "references"), { recursive: true });
    writeFileSync(join(skill, "references", "old.md"), "from an older bundle");
    writeFileSync(join(skill, "SKILL.md"), "edited by hand");

    expect(runInstallAll().exitCode).toBe(0);
    expect(existsSync(join(skill, "stale.md"))).toBe(false);
    expect(existsSync(join(skill, "references"))).toBe(false);
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toContain("name: mtq-code");
  }, 60_000);
});

describe("install:all follows the folders the tools themselves use", () => {
  it("puts the MCP entry and the skills in $CLAUDE_CONFIG_DIR, $CODEX_HOME and $XDG_CONFIG_HOME", () => {
    const moved = join(sandbox, "moved");
    const at = join(moved, "home");
    const [claude, codex, xdg] = ["claude-config", "codex-home", "xdg-config"].map((d) => join(moved, d));
    // Each tool counts as installed by what it wrote in its own folder.
    for (const file of [
      join(claude, "settings.json"),
      join(codex, "auth.json"),
      join(xdg, "opencode", "package.json"),
    ]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "{}");
    }
    mkdirSync(at, { recursive: true });

    const env = { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, XDG_CONFIG_HOME: xdg };
    expect(runInstallAll([], { at, env, noTools: true }).exitCode).toBe(0);

    expect(existsSync(join(claude, ".claude.json"))).toBe(true);
    const config = Bun.TOML.parse(readFileSync(join(codex, "config.toml"), "utf8")) as {
      mcp_servers: { mtq: { command: string } };
    };
    expect(config.mcp_servers.mtq.command).toBeTruthy();
    for (const skills of [join(claude, "skills"), join(codex, "skills"), join(xdg, "opencode", "skills")]) {
      expect(existsSync(join(skills, "mtq-claim", "SKILL.md"))).toBe(true);
    }
    // Nothing goes where the tools do not look.
    for (const dir of [".claude", ".claude.json", ".codex", ".config"]) {
      expect(existsSync(join(at, dir))).toBe(false);
    }
  }, 60_000);

  it("leaves tools that are not installed alone and refreshes the copies a tool already holds", () => {
    const at = join(sandbox, "partial-home");
    mkdirSync(join(at, ".claude"), { recursive: true });
    writeFileSync(join(at, ".claude", "settings.json"), "{}");
    // Junie has no MCP registration, but an earlier install left an old copy of a skill there.
    const old = join(at, ".junie", "skills", "mtq-claim");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "SKILL.md"), '---\nname: mtq-claim\nmetadata:\n  version: "1.0.0"\n---\nold');

    const { exitCode, stdout } = runInstallAll([], { at, noTools: true });
    expect(exitCode).toBe(0);

    expect(existsSync(join(at, ".claude", "skills", "mtq-claim", "SKILL.md"))).toBe(true);
    expect(skillVersion(readFileSync(join(old, "SKILL.md"), "utf8"))).toBe(skillsBundleVersion());
    // Kimi Code, Codex and OpenCode are not here: no folder is made for them.
    for (const dir of [".kimi-code", ".codex", ".config"]) expect(existsSync(join(at, dir))).toBe(false);
    expect(stdout).toContain("Skills not installed in kimi");
  }, 60_000);
});
