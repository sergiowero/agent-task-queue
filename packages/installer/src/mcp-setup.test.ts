import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { McpServerLaunch } from "@agentq/mcp";
import type { SetupEnv } from "./mcp-setup.js";
import { TARGETS, manualEntry, registerAll } from "./mcp-setup.js";

// Every test works in its own temp home: real tool configs are never read or written.
const launch: McpServerLaunch = {
  command: "C:\\Program Files\\bun\\bun.exe",
  args: ["run", "/agentq/packages/mcp/src/index.ts"],
  env: { AGENTQ_DB_PATH: "/data/agentq.db" },
};

let home: string;
let env: SetupEnv;

function paths() {
  return {
    claude: join(home, ".claude.json"),
    codex: join(home, ".codex", "config.toml"),
    opencode: join(home, ".config", "opencode", "opencode.json"),
    gemini: join(home, ".gemini", "settings.json"),
    copilot: join(home, ".copilot", "mcp-config.json"),
    vscode: join(home, ".config", "Code", "User", "mcp.json"),
  };
}

function statuses(results: ReturnType<typeof registerAll>) {
  return Object.fromEntries(results.map((r) => [r.tool, r.status]));
}

function snapshot(): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(paths()).map(([tool, p]) => [
      tool,
      existsSync(p) ? readFileSync(p, "utf8") : null,
    ]),
  );
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentq-mcp-setup-"));
  // Every tool "installed": its binary is on PATH.
  env = { homeDir: home, platform: "linux", env: {}, which: (bin) => `/usr/bin/${bin}` };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("registerAll", () => {
  it("registers the server with every installed tool", () => {
    const results = registerAll(launch, env);
    expect(statuses(results)).toEqual({
      claude: "added",
      codex: "added",
      opencode: "added",
      gemini: "added",
      copilot: "added",
      vscode: "added",
    });
    const p = paths();

    expect(JSON.parse(readFileSync(p.claude, "utf8")).mcpServers.agentq).toEqual({
      type: "stdio",
      ...launch,
    });
    const codex = Bun.TOML.parse(readFileSync(p.codex, "utf8")) as any;
    expect(codex.mcp_servers.agentq).toEqual(launch);
    expect(JSON.parse(readFileSync(p.opencode, "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        agentq: {
          type: "local",
          command: [launch.command, ...launch.args],
          environment: launch.env,
          enabled: true,
        },
      },
    });
    expect(JSON.parse(readFileSync(p.gemini, "utf8")).mcpServers.agentq).toEqual(launch);
    expect(JSON.parse(readFileSync(p.copilot, "utf8"))).toEqual({
      mcpServers: { agentq: { type: "local", ...launch, tools: ["*"] } },
    });
    expect(JSON.parse(readFileSync(p.vscode, "utf8"))).toEqual({
      servers: { agentq: { type: "stdio", ...launch } },
    });
  });

  it("is safe to rerun: the second run changes nothing", () => {
    registerAll(launch, env);
    const first = snapshot();
    const again = registerAll(launch, env);
    expect(statuses(again)).toEqual({
      claude: "unchanged",
      codex: "unchanged",
      opencode: "unchanged",
      gemini: "unchanged",
      copilot: "unchanged",
      vscode: "unchanged",
    });
    expect(snapshot()).toEqual(first);
    // Three runs do not pile up entries either.
    registerAll(launch, env);
    expect(readFileSync(paths().codex, "utf8").match(/\[mcp_servers\.agentq\]/g)).toHaveLength(1);
  });

  it("updates an out-of-date entry and keeps everything else in the file", () => {
    const p = paths();
    writeFileSync(
      p.claude,
      JSON.stringify({
        theme: "dark",
        mcpServers: { other: { command: "x" }, agentq: { command: "old" } },
      }),
    );
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      p.codex,
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.agentq]",
        'command = "old-bun"',
        'args = ["old.ts"]',
        "",
        "[mcp_servers.agentq.env]",
        'AGENTQ_DB_PATH = "/old.db"',
        "",
        '[mcp_servers."other"]',
        'command = "other-mcp"',
        "",
      ].join("\n"),
    );
    mkdirSync(join(home, ".gemini"), { recursive: true });
    const geminiBefore = JSON.stringify({ theme: "GitHub", mcpServers: { agentq: launch } });
    writeFileSync(p.gemini, geminiBefore);
    mkdirSync(join(home, ".config", "Code", "User"), { recursive: true });
    writeFileSync(
      p.vscode,
      JSON.stringify({
        servers: { github: { type: "http", url: "https://example.com/mcp" } },
        inputs: [{ id: "token", type: "promptString" }],
      }),
    );

    const results = registerAll(launch, env);
    expect(statuses(results)).toEqual({
      claude: "updated",
      codex: "updated",
      opencode: "added",
      gemini: "unchanged",
      copilot: "added",
      vscode: "added",
    });

    const claude = JSON.parse(readFileSync(p.claude, "utf8"));
    expect(claude.theme).toBe("dark");
    expect(claude.mcpServers.other).toEqual({ command: "x" });
    expect(claude.mcpServers.agentq.command).toBe(launch.command);

    const codex = Bun.TOML.parse(readFileSync(p.codex, "utf8")) as any;
    expect(codex.model).toBe("gpt-5");
    expect(codex.mcp_servers.other).toEqual({ command: "other-mcp" });
    expect(codex.mcp_servers.agentq).toEqual(launch);

    // Already current: not rewritten, not even reformatted.
    expect(readFileSync(p.gemini, "utf8")).toBe(geminiBefore);

    const vscode = JSON.parse(readFileSync(p.vscode, "utf8"));
    expect(vscode.inputs).toEqual([{ id: "token", type: "promptString" }]);
    expect(vscode.servers.github).toEqual({ type: "http", url: "https://example.com/mcp" });
    expect(vscode.servers.agentq.command).toBe(launch.command);
  });

  it("skips tools that are not installed", () => {
    env.which = (bin) => (bin === "claude" ? "/usr/bin/claude" : null);
    // Installed without being on PATH: the tool wrote its own files.
    mkdirSync(join(home, ".gemini"));
    writeFileSync(join(home, ".gemini", "oauth_creds.json"), "{}");
    // Only what install:skills created: not installed.
    mkdirSync(join(home, ".codex", "skills"), { recursive: true });
    mkdirSync(join(home, ".config", "opencode", "skills"), { recursive: true });
    mkdirSync(join(home, ".copilot", "skills"), { recursive: true });
    // VS Code without `code` on PATH: its user folder holds its settings.
    mkdirSync(join(home, ".config", "Code", "User"), { recursive: true });
    writeFileSync(join(home, ".config", "Code", "User", "settings.json"), "{}");
    const results = registerAll(launch, env);
    expect(statuses(results)).toEqual({
      claude: "added",
      codex: "not_installed",
      opencode: "not_installed",
      gemini: "added",
      copilot: "not_installed",
      vscode: "added",
    });
    expect(existsSync(paths().codex)).toBe(false);
    expect(existsSync(paths().opencode)).toBe(false);
    expect(existsSync(paths().copilot)).toBe(false);
  });

  it("honours CLAUDE_CONFIG_DIR, CODEX_HOME, COPILOT_HOME and XDG_CONFIG_HOME", () => {
    env.env = {
      CLAUDE_CONFIG_DIR: join(home, "claude-config"),
      CODEX_HOME: join(home, "codex-home"),
      COPILOT_HOME: join(home, "copilot-home"),
      XDG_CONFIG_HOME: join(home, "xdg"),
    };
    const results = registerAll(launch, env);
    expect(results.map((r) => r.configPath)).toEqual([
      join(home, "claude-config", ".claude.json"),
      join(home, "codex-home", "config.toml"),
      join(home, "xdg", "opencode", "opencode.json"),
      join(home, ".gemini", "settings.json"),
      join(home, "copilot-home", "mcp-config.json"),
      join(home, "xdg", "Code", "User", "mcp.json"),
    ]);
    for (const r of results) expect(existsSync(r.configPath)).toBe(true);
  });

  it("finds the VS Code user folder on Windows and macOS", () => {
    const vscodePath = () => registerAll(launch, env).find((r) => r.tool === "vscode")!.configPath;
    env.platform = "win32";
    expect(vscodePath()).toBe(join(home, "AppData", "Roaming", "Code", "User", "mcp.json"));
    env.env = { APPDATA: join(home, "roaming") };
    expect(vscodePath()).toBe(join(home, "roaming", "Code", "User", "mcp.json"));
    env.platform = "darwin";
    expect(vscodePath()).toBe(
      join(home, "Library", "Application Support", "Code", "User", "mcp.json"),
    );
  });

  it("leaves a file it cannot read untouched and reports it", () => {
    const p = paths();
    mkdirSync(join(home, ".gemini"), { recursive: true });
    writeFileSync(p.gemini, "{ // a comment\n}");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(p.codex, 'mcp_servers.agentq = { command = "inline" }\n');

    const results = registerAll(launch, env);
    const byTool = Object.fromEntries(results.map((r) => [r.tool, r]));
    expect(byTool.gemini.status).toBe("failed");
    expect(byTool.gemini.message).toBeTruthy();
    expect(readFileSync(p.gemini, "utf8")).toBe("{ // a comment\n}");
    expect(byTool.codex.status).toBe("failed");
    expect(byTool.codex.message).toContain("inline");
    expect(readFileSync(p.codex, "utf8")).toBe('mcp_servers.agentq = { command = "inline" }\n');
    expect(byTool.claude.status).toBe("added");
  });

  it("reads files saved on Windows (UTF-8 BOM, CRLF line endings)", () => {
    const p = paths();
    mkdirSync(join(home, ".gemini"), { recursive: true });
    writeFileSync(p.gemini, '\uFEFF{\r\n  "theme": "GitHub"\r\n}\r\n');
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      p.codex,
      '\uFEFFmodel = "gpt-5"\r\n\r\n[mcp_servers.agentq]\r\ncommand = "old"\r\n',
    );

    const results = registerAll(launch, env);
    expect(statuses(results)).toMatchObject({ gemini: "added", codex: "updated" });
    const gemini = JSON.parse(readFileSync(p.gemini, "utf8"));
    expect(gemini).toEqual({ theme: "GitHub", mcpServers: { agentq: launch } });
    const codex = Bun.TOML.parse(readFileSync(p.codex, "utf8")) as any;
    expect(codex.model).toBe("gpt-5");
    expect(codex.mcp_servers.agentq).toEqual(launch);
    expect(statuses(registerAll(launch, env))).toMatchObject({
      gemini: "unchanged",
      codex: "unchanged",
    });
  });

  it("uses an existing opencode.jsonc when there is no opencode.json", () => {
    const dir = join(home, ".config", "opencode");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "opencode.jsonc"), JSON.stringify({ model: "x" }));
    const opencode = registerAll(launch, env).find((r) => r.tool === "opencode")!;
    expect(opencode.configPath).toBe(join(dir, "opencode.jsonc"));
    expect(opencode.status).toBe("added");
    expect(JSON.parse(readFileSync(join(dir, "opencode.jsonc"), "utf8")).model).toBe("x");
    expect(existsSync(join(dir, "opencode.json"))).toBe(false);
  });
});

describe("manualEntry", () => {
  it("prints the block to paste for each tool", () => {
    for (const target of TARGETS) {
      const text = manualEntry(target.tool, launch);
      expect(text).toContain("agentq");
      expect(text).toContain("AGENTQ_DB_PATH");
    }
    expect(Bun.TOML.parse(manualEntry("codex", launch))).toEqual({
      mcp_servers: { agentq: launch },
    });
    expect(JSON.parse(manualEntry("opencode", launch)).mcp.agentq.type).toBe("local");
    expect(JSON.parse(manualEntry("copilot", launch)).mcpServers.agentq.tools).toEqual(["*"]);
    expect(JSON.parse(manualEntry("vscode", launch)).servers.agentq.type).toBe("stdio");
  });
});
