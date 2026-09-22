import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  clearModelCache,
  discoverModels,
  parseClaudeHelp,
  parseCodexConfig,
  parseCodexModels,
  parseOpencodeModels,
  type ExecFn,
} from "./models.js";

// Every test gets a fresh, empty "home" so the real ~/.codex, ~/.claude.json and
// ~/.gemini never leak into the expectations.
const HOME = join(tmpdir(), `agentq-models-home-${randomUUID()}`);

const OPENCODE_OUTPUT = [
  "opencode/big-pickle",
  "opencode/nemotron-3-ultra-free",
  "github-copilot/claude-opus-5",
  "github-copilot/gpt-5.5",
  "",
].join("\n");

const CODEX_OUTPUT = JSON.stringify({
  models: [
    {
      slug: "gpt-reserve",
      display_name: "GPT-Reserve",
      description: "Hidden fallback.",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
      visibility: "hide",
      priority: 3,
    },
    {
      slug: "gpt-5.6-terra",
      display_name: "GPT-5.6-Terra",
      description: "Frontier agentic model.",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [
        { effort: "low", description: "" },
        { effort: "medium", description: "" },
        { effort: "high", description: "" },
        { effort: "xhigh", description: "" },
        { effort: "max", description: "" },
        { effort: "ultra", description: "" },
      ],
      visibility: "list",
      priority: 7,
    },
    {
      slug: "gpt-5.5",
      display_name: "GPT-5.5",
      description: "Previous generation.",
      default_reasoning_level: "high",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
      visibility: "list",
      priority: 12,
    },
  ],
});

const CLAUDE_HELP = `Usage: claude [options] [command] [prompt]

Options:
  -d, --debug [filter]                  Enable debug mode
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --environment <environment_id>        Create a new cloud session that runs on
                                        the given self-hosted environment
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name (e.g.
                                        'claude-fable-5').
  -n, --name <name>                     Set a display name for this session
  -h, --help                            Display help for command
`;

/** Fake exec keyed by the joined argv; unknown commands "fail" with exit 127. */
function fakeExec(table: Record<string, string>, calls: string[][] = []): ExecFn {
  return async (cmd) => {
    calls.push(cmd);
    const key = cmd.join(" ");
    return key in table ? { stdout: table[key], exitCode: 0 } : { stdout: "", exitCode: 127 };
  };
}

const failingExec: ExecFn = async () => ({ stdout: "", exitCode: 127 });
const throwingExec: ExecFn = async () => {
  throw new Error("spawn failed");
};

beforeEach(() => {
  clearModelCache();
  rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
});

afterAll(() => {
  clearModelCache();
  rmSync(HOME, { recursive: true, force: true });
});

describe("parsers", () => {
  it("parses opencode lines into provider/model options", () => {
    const models = parseOpencodeModels(`${OPENCODE_OUTPUT}\nnot a model line\n/leading\ntrailing/\n`);
    expect(models.map((m) => m.id)).toEqual([
      "opencode/big-pickle",
      "opencode/nemotron-3-ultra-free",
      "github-copilot/claude-opus-5",
      "github-copilot/gpt-5.5",
    ]);
    expect(models[2]).toEqual({ id: "github-copilot/claude-opus-5", label: "claude-opus-5", description: "github-copilot" });
  });

  it("keeps only listed codex models, lowest priority number first", () => {
    const models = parseCodexModels(CODEX_OUTPUT);
    expect(models.map((m) => m.id)).toEqual(["gpt-5.6-terra", "gpt-5.5"]);
    expect(models[0]).toEqual({
      id: "gpt-5.6-terra",
      label: "GPT-5.6-Terra",
      description: "Frontier agentic model.",
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "medium",
    });
    expect(parseCodexModels("not json")).toEqual([]);
    expect(parseCodexModels("{}")).toEqual([]);
  });

  it("reads only top-level model keys from codex config.toml", () => {
    const toml = `# comment
model = "gpt-5.6-sol"
model_reasoning_effort = "max"
model_provider = "openai"

[profiles.fast]
model = "gpt-5.5"
model_reasoning_effort = "low"
`;
    expect(parseCodexConfig(toml)).toEqual({ model: "gpt-5.6-sol", effort: "max" });
    expect(parseCodexConfig(`[profiles.x]\nmodel = "y"\n`)).toEqual({ model: null, effort: null });
    expect(parseCodexConfig("")).toEqual({ model: null, effort: null });
  });

  it("extracts claude aliases and effort levels from --help", () => {
    expect(parseClaudeHelp(CLAUDE_HELP)).toEqual({
      aliases: ["fable", "opus", "sonnet"],
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(parseClaudeHelp("Usage: claude\n\nOptions:\n  -h, --help  help\n")).toEqual({ aliases: [], efforts: [] });
  });
});

describe("discoverModels", () => {
  it("opencode: groups by provider and exposes the static variant list", async () => {
    const calls: string[][] = [];
    const result = await discoverModels("opencode", fakeExec({ "opencode models": OPENCODE_OUTPUT }, calls), { homeDir: HOME });
    expect(calls).toEqual([["opencode", "models"]]);
    expect(result.tool).toBe("opencode");
    expect(result.source).toBe("cli");
    expect(result.models).toHaveLength(4);
    expect(result.models[0]).toEqual({ id: "opencode/big-pickle", label: "big-pickle", description: "opencode" });
    expect(result.efforts).toEqual(["minimal", "low", "medium", "high", "max"]);
    expect(result.defaultEffort).toBeNull();
  });

  it("codex: lists visible models with efforts and prepends the configured model", async () => {
    mkdirSync(join(HOME, ".codex"), { recursive: true });
    writeFileSync(join(HOME, ".codex", "config.toml"), `model = "gpt-5.6-sol"\nmodel_reasoning_effort = "max"\n\n[mcp_servers.x]\ncommand = "y"\n`);
    const result = await discoverModels("codex", fakeExec({ "codex debug models": CODEX_OUTPUT }), { homeDir: HOME });
    expect(result.source).toBe("cli");
    expect(result.models.map((m) => m.id)).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"]);
    expect(result.models[0]).toMatchObject({ label: "gpt-5.6-sol (configured)", defaultEffort: "max" });
    expect(result.models[0].efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(result.models[2]).toMatchObject({ label: "GPT-5.5", efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "high" });
    // Union of every listed model's levels, low → ultra.
    expect(result.efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(result.defaultEffort).toBe("max");
  });

  it("codex: does not duplicate a configured model that the CLI already lists", async () => {
    mkdirSync(join(HOME, ".codex"), { recursive: true });
    writeFileSync(join(HOME, ".codex", "config.toml"), `model = "gpt-5.5"\n`);
    const result = await discoverModels("codex", fakeExec({ "codex debug models": CODEX_OUTPUT }), { homeDir: HOME });
    expect(result.models.map((m) => m.id)).toEqual(["gpt-5.6-terra", "gpt-5.5"]);
    expect(result.defaultEffort).toBeNull();
  });

  it("claude: merges help aliases, ~/.claude.json extras and the static full IDs", async () => {
    writeFileSync(
      join(HOME, ".claude.json"),
      JSON.stringify({
        additionalModelOptionsCache: [
          { value: "claude-fable-5-1[1m]", label: "Fable", description: "Fable 5.1 · 1M context" },
          { value: "claude-opus-5", label: "Opus (dup of static id)" },
          { value: "", label: "ignored" },
        ],
      }),
    );
    const result = await discoverModels("claude", fakeExec({ "claude --help": CLAUDE_HELP }), { homeDir: HOME });
    expect(result.source).toBe("cli");
    expect(result.models.map((m) => m.id)).toEqual([
      "fable",
      "opus",
      "sonnet",
      "haiku",
      "claude-fable-5-1[1m]",
      "claude-opus-5",
      "claude-fable-5-1",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
    expect(result.models[0]).toEqual({ id: "fable", label: "fable", description: "alias" });
    expect(result.models[4]).toEqual({ id: "claude-fable-5-1[1m]", label: "Fable", description: "Fable 5.1 · 1M context" });
    expect(result.models[5].label).toBe("Opus (dup of static id)");
    expect(result.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(result.defaultEffort).toBeNull();
  });

  it("claude: falls back to the static aliases when --help cannot be parsed", async () => {
    const result = await discoverModels("claude", fakeExec({ "claude --help": "garbage" }), { homeDir: HOME });
    expect(result.source).toBe("static");
    expect(result.models.map((m) => m.id)).toEqual([
      "fable", "opus", "sonnet", "haiku",
      "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001",
    ]);
    expect(result.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("gemini: static list, no efforts, configured model first", async () => {
    const calls: string[][] = [];
    let result = await discoverModels("gemini", fakeExec({}, calls), { homeDir: HOME });
    expect(calls).toEqual([]);
    expect(result).toEqual({
      tool: "gemini",
      source: "static",
      models: [
        { id: "gemini-2.5-pro", label: "gemini-2.5-pro" },
        { id: "gemini-2.5-flash", label: "gemini-2.5-flash" },
        { id: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" },
      ],
      efforts: null,
      defaultEffort: null,
    });

    clearModelCache();
    mkdirSync(join(HOME, ".gemini"), { recursive: true });
    writeFileSync(join(HOME, ".gemini", "settings.json"), JSON.stringify({ model: { name: "auto-gemini-2.5" } }));
    result = await discoverModels("gemini", fakeExec({}), { homeDir: HOME });
    expect(result.models[0]).toEqual({ id: "auto-gemini-2.5", label: "auto-gemini-2.5 (configured)" });
    expect(result.models).toHaveLength(4);

    clearModelCache();
    writeFileSync(join(HOME, ".gemini", "settings.json"), JSON.stringify({ model: "gemini-2.5-flash" }));
    result = await discoverModels("gemini", fakeExec({}), { homeDir: HOME });
    expect(result.models).toHaveLength(3);
  });

  it("custom: nothing to choose from", async () => {
    expect(await discoverModels("custom", failingExec, { homeDir: HOME })).toEqual({
      tool: "custom",
      source: "static",
      models: [],
      efforts: null,
      defaultEffort: null,
    });
  });

  it("falls back to static data when the CLI is missing or exec throws", async () => {
    const opencode = await discoverModels("opencode", failingExec, { homeDir: HOME });
    expect(opencode).toMatchObject({ source: "static", models: [], efforts: ["minimal", "low", "medium", "high", "max"] });

    const codex = await discoverModels("codex", throwingExec, { homeDir: HOME });
    expect(codex).toMatchObject({ source: "static", models: [], efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: null });

    const claude = await discoverModels("claude", throwingExec, { homeDir: HOME });
    expect(claude.source).toBe("static");
    expect(claude.models.map((m) => m.id)).toContain("sonnet");
  });

  it("caches per tool for later calls and honours force", async () => {
    const calls: string[][] = [];
    const exec = fakeExec({ "opencode models": OPENCODE_OUTPUT, "claude --help": CLAUDE_HELP }, calls);

    const first = await discoverModels("opencode", exec, { homeDir: HOME });
    expect(first.source).toBe("cli");
    const second = await discoverModels("opencode", exec, { homeDir: HOME });
    expect(second.source).toBe("cache");
    expect(second.models).toEqual(first.models);
    expect(calls).toHaveLength(1);

    // Another tool has its own entry.
    expect((await discoverModels("claude", exec, { homeDir: HOME })).source).toBe("cli");
    expect(calls).toHaveLength(2);

    const forced = await discoverModels("opencode", exec, { homeDir: HOME, force: true });
    expect(forced.source).toBe("cli");
    expect(calls).toHaveLength(3);

    // A cached copy is not shared by reference.
    second.models.push({ id: "x", label: "x" });
    expect((await discoverModels("opencode", exec, { homeDir: HOME })).models).toHaveLength(4);
  });
});
