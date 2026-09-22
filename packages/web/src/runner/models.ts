import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { RunnerTool } from "@agentq/shared";

export interface ModelOption {
  /** Value handed to the tool (`--model`, `-m`). */
  id: string;
  label: string;
  /** Provider (opencode), model blurb (codex/claude) or a group name. */
  description?: string;
  /** Per-model effort levels when the tool reports them (codex). */
  efforts?: string[];
  defaultEffort?: string;
}

export type ModelSource = "cli" | "cache" | "static";

export interface ModelDiscovery {
  tool: RunnerTool;
  source: ModelSource;
  models: ModelOption[];
  /** Tool-level effort levels; null when the tool has no effort flag. */
  efforts: string[] | null;
  defaultEffort?: string | null;
}

export type ExecFn = (cmd: string[]) => Promise<{ stdout: string; exitCode: number }>;

export interface DiscoverOptions {
  /** Skip the in-memory cache. */
  force?: boolean;
  /** Where `~/.codex`, `~/.claude.json` and `~/.gemini` live (tests point it at a temp dir). */
  homeDir?: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const EXEC_TIMEOUT_MS = 15_000;

/** Same guard as commands.ts: a nested Claude Code session refuses to start. */
const STRIPPED_ENV = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

const OPENCODE_EFFORTS = ["minimal", "low", "medium", "high", "max"];
const CODEX_STATIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_STATIC_ALIASES = ["fable", "opus", "sonnet", "haiku"];
const CLAUDE_STATIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_STATIC_IDS = ["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];
const GEMINI_STATIC_IDS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

/** Canonical low→ultra order used when merging per-model effort lists. */
const EFFORT_RANK = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export const defaultExec: ExecFn = async (cmd) => {
  if (!Bun.which(cmd[0])) return { stdout: "", exitCode: 127 };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !STRIPPED_ENV.includes(k)) env[k] = v;
  }
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", env });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {}
    }, EXEC_TIMEOUT_MS);
    const stdout = await new Response(proc.stdout as ReadableStream).text();
    const exitCode = await proc.exited;
    clearTimeout(timer);
    return { stdout, exitCode: timedOut ? -1 : exitCode };
  } catch {
    return { stdout: "", exitCode: 127 };
  }
};

let execOverride: ExecFn | null = null;

/** Tests route every CLI call through a fake; pass null to restore the real one. */
export function setModelExecForTests(exec: ExecFn | null): void {
  execOverride = exec;
}

const cache = new Map<RunnerTool, { expires: number; result: ModelDiscovery }>();

export function clearModelCache(): void {
  cache.clear();
}

export async function discoverModels(
  tool: RunnerTool,
  exec: ExecFn = execOverride ?? defaultExec,
  opts: DiscoverOptions = {},
): Promise<ModelDiscovery> {
  if (tool === "custom") return { tool, source: "static", models: [], efforts: null, defaultEffort: null };

  const hit = cache.get(tool);
  if (!opts.force && hit && hit.expires > Date.now()) {
    return { ...hit.result, models: [...hit.result.models], source: "cache" };
  }

  const home = opts.homeDir ?? homedir();
  let result: ModelDiscovery;
  switch (tool) {
    case "opencode":
      result = await discoverOpencode(exec);
      break;
    case "codex":
      result = await discoverCodex(exec, home);
      break;
    case "claude":
      result = await discoverClaude(exec, home);
      break;
    case "gemini":
      result = discoverGemini(home);
      break;
    default: {
      const never: never = tool;
      throw new Error(`Unknown runner tool: ${String(never)}`);
    }
  }
  cache.set(tool, { expires: Date.now() + CACHE_TTL_MS, result });
  return { ...result, models: [...result.models] };
}

// ─── helpers ────────────────────────────────────────────────────────

async function tryExec(exec: ExecFn, cmd: string[]): Promise<string | null> {
  try {
    const { stdout, exitCode } = await exec(cmd);
    if (exitCode !== 0 || !stdout.trim()) return null;
    return stdout;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJson(path: string): any | null {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sortEfforts(efforts: Iterable<string>): string[] {
  const seen = [...new Set(efforts)];
  const rank = (e: string) => {
    const i = EFFORT_RANK.indexOf(e);
    return i === -1 ? EFFORT_RANK.length + seen.indexOf(e) : i;
  };
  return seen.sort((a, b) => rank(a) - rank(b));
}

// ─── opencode ───────────────────────────────────────────────────────

/** One `provider/model` per line. */
export function parseOpencodeModels(stdout: string): ModelOption[] {
  const models: ModelOption[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    const slash = line.indexOf("/");
    if (!line || slash <= 0 || slash === line.length - 1 || /\s/.test(line)) continue;
    models.push({ id: line, label: line.slice(slash + 1), description: line.slice(0, slash) });
  }
  return models;
}

async function discoverOpencode(exec: ExecFn): Promise<ModelDiscovery> {
  const out = await tryExec(exec, ["opencode", "models"]);
  const models = out ? parseOpencodeModels(out) : [];
  return {
    tool: "opencode",
    source: models.length ? "cli" : "static",
    models,
    efforts: OPENCODE_EFFORTS,
    defaultEffort: null,
  };
}

// ─── codex ──────────────────────────────────────────────────────────

/** `codex debug models` JSON → listed models, lowest priority number first (newest, as in the codex picker). */
export function parseCodexModels(stdout: string): ModelOption[] {
  let json: any;
  try {
    json = JSON.parse(stdout);
  } catch {
    return [];
  }
  const list: any[] = Array.isArray(json?.models) ? json.models : [];
  return list
    .filter((m) => m && typeof m.slug === "string" && m.visibility === "list")
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || String(a.slug).localeCompare(String(b.slug)))
    .map((m) => {
      const efforts = (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [])
        .map((l: any) => (typeof l?.effort === "string" ? l.effort : null))
        .filter((e: string | null): e is string => !!e);
      const option: ModelOption = { id: m.slug, label: typeof m.display_name === "string" && m.display_name ? m.display_name : m.slug };
      if (typeof m.description === "string" && m.description) option.description = m.description;
      if (efforts.length) option.efforts = efforts;
      if (typeof m.default_reasoning_level === "string" && m.default_reasoning_level) option.defaultEffort = m.default_reasoning_level;
      return option;
    });
}

/** Top-level `model = "..."` / `model_reasoning_effort = "..."` from ~/.codex/config.toml (no TOML parser). */
export function parseCodexConfig(toml: string): { model: string | null; effort: string | null } {
  // Only the preamble: keys after the first `[table]` header belong to that table (profiles, mcp servers...).
  const preamble = toml.split(/^\s*\[/m)[0] ?? "";
  const model = preamble.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  const effort = preamble.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  return { model, effort };
}

async function discoverCodex(exec: ExecFn, home: string): Promise<ModelDiscovery> {
  const out = await tryExec(exec, ["codex", "debug", "models"]);
  const models = out ? parseCodexModels(out) : [];
  const fromCli = models.length > 0;

  const config = parseCodexConfig(readText(join(home, ".codex", "config.toml")) ?? "");
  const union = new Set<string>();
  for (const m of models) for (const e of m.efforts ?? []) union.add(e);
  const efforts = union.size ? sortEfforts(union) : CODEX_STATIC_EFFORTS;

  if (config.model && !models.some((m) => m.id === config.model)) {
    const configured: ModelOption = { id: config.model, label: `${config.model} (configured)`, efforts };
    if (config.effort) configured.defaultEffort = config.effort;
    models.unshift(configured);
  }

  return {
    tool: "codex",
    source: fromCli ? "cli" : "static",
    models,
    efforts,
    defaultEffort: config.effort,
  };
}

// ─── claude ─────────────────────────────────────────────────────────

/** The `--flag` line of a commander-style help plus its wrapped continuation lines, whitespace-collapsed. */
function helpOptionText(help: string, flag: string): string | null {
  const lines = help.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s+(-\\w,\\s+)?${flag}(\\s|$)`).test(l));
  if (start === -1) return null;
  const chunk = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*-/.test(l)) break;
    chunk.push(l);
  }
  return chunk.join(" ").replace(/\s+/g, " ");
}

/** Aliases quoted in the `--model` description ('fable', 'opus', ...) and the `--effort` levels. */
export function parseClaudeHelp(help: string): { aliases: string[]; efforts: string[] } {
  const modelText = helpOptionText(help, "--model");
  const aliases = modelText ? [...modelText.matchAll(/'([a-z][a-z0-9]*)'/g)].map((m) => m[1]) : [];
  const effortText = helpOptionText(help, "--effort");
  const paren = effortText?.match(/\(([^)]+)\)/)?.[1] ?? "";
  const efforts = paren
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[a-z]+$/.test(e));
  return { aliases: [...new Set(aliases)], efforts };
}

async function discoverClaude(exec: ExecFn, home: string): Promise<ModelDiscovery> {
  const help = await tryExec(exec, ["claude", "--help"]);
  const parsed = help ? parseClaudeHelp(help) : { aliases: [], efforts: [] };
  const fromCli = parsed.aliases.length > 0;

  const aliases = fromCli ? [...parsed.aliases] : [...CLAUDE_STATIC_ALIASES];
  if (!aliases.includes("haiku")) aliases.push("haiku");
  const models: ModelOption[] = aliases.map((a) => ({ id: a, label: a, description: "alias" }));

  const cached = readJson(join(home, ".claude.json"))?.additionalModelOptionsCache;
  if (Array.isArray(cached)) {
    for (const entry of cached) {
      if (!entry || typeof entry.value !== "string" || !entry.value) continue;
      if (models.some((m) => m.id === entry.value)) continue;
      const option: ModelOption = { id: entry.value, label: typeof entry.label === "string" && entry.label ? entry.label : entry.value };
      if (typeof entry.description === "string" && entry.description) option.description = entry.description;
      models.push(option);
    }
  }

  for (const id of CLAUDE_STATIC_IDS) {
    if (!models.some((m) => m.id === id)) models.push({ id, label: id, description: "full model ID" });
  }

  return {
    tool: "claude",
    source: fromCli ? "cli" : "static",
    models,
    efforts: parsed.efforts.length ? parsed.efforts : CLAUDE_STATIC_EFFORTS,
    defaultEffort: null,
  };
}

// ─── gemini ─────────────────────────────────────────────────────────

function discoverGemini(home: string): ModelDiscovery {
  const models: ModelOption[] = GEMINI_STATIC_IDS.map((id) => ({ id, label: id }));
  const settings = readJson(join(home, ".gemini", "settings.json"));
  const raw = settings?.model;
  const configured = typeof raw === "string" ? raw : typeof raw?.name === "string" ? raw.name : null;
  if (configured && !models.some((m) => m.id === configured)) {
    models.unshift({ id: configured, label: `${configured} (configured)` });
  }
  return { tool: "gemini", source: "static", models, efforts: null, defaultEffort: null };
}
