import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { claudeHome, codexHome, opencodeHome, type ToolEnv } from "./tool-paths.js";

/** The repo's `skills/` folder: the source of truth for every Moonlight Task Queue skill. */
export const SKILLS_DIR = resolve(import.meta.dir, "../../../skills");

/** Every Moonlight Task Queue skill folder starts with this; the installer owns folders with this prefix. */
export const SKILL_PREFIX = "mtq-";

/**
 * Oldest skills bundle the server still works with. Agents that report an older
 * `skillsVersion` on claim_task are refused with `reason: "skills_outdated"`.
 */
export const MIN_COMPATIBLE_SKILLS_VERSION = "7.0.0";

/**
 * Where each coding tool looks for skills (resolved at call time, so HOME and the
 * tools' own variables apply): Claude Code under `$CLAUDE_CONFIG_DIR`, Codex under
 * `$CODEX_HOME`, OpenCode under `$XDG_CONFIG_HOME`: the folders the MCP
 * registration goes to.
 */
export function toolSkillDirs(env: ToolEnv = process.env, home: string = homedir()): Record<string, string> {
  return {
    claude: join(claudeHome(env, home), "skills"),
    opencode: join(opencodeHome(env, home), "skills"),
    codex: join(codexHome(env, home), "skills"),
    kimi: join(home, ".kimi-code/skills"),
    junie: join(home, ".junie/skills"),
  };
}

/** Strips the leading `--- ... ---` YAML frontmatter block, if present. */
export function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? md.slice(m[0].length).trimStart() : md;
}

/** `metadata.version` from a SKILL.md frontmatter, or null. */
export function skillVersion(md: string): string | null {
  const front = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) return null;
  const version = front[1].match(/^\s*version:\s*["']?([\w.-]+)["']?\s*$/m);
  return version ? version[1] : null;
}

/** Skill folders (those with a SKILL.md) in `dir`, sorted. */
export function listSkills(dir: string = SKILLS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

export interface SkillDocument {
  name: string;
  version: string | null;
  /** SKILL.md without its frontmatter. */
  body: string;
}

export function readSkill(name: string, dir: string = SKILLS_DIR): SkillDocument | null {
  const file = join(dir, name, "SKILL.md");
  if (!existsSync(file)) return null;
  const md = readFileSync(file, "utf8");
  return { name, version: skillVersion(md), body: stripFrontmatter(md) };
}

/** Skill name → version for every skill in `dir`. */
export function skillsManifest(dir: string = SKILLS_DIR): Record<string, string | null> {
  return Object.fromEntries(listSkills(dir).map((name) => [name, readSkill(name, dir)?.version ?? null]));
}

/** Version of the whole bundle (every mtq-* skill carries the same one; a test enforces it). */
export function skillsBundleVersion(dir: string = SKILLS_DIR): string | null {
  return readSkill(`${SKILL_PREFIX}claim`, dir)?.version ?? null;
}

/** Semver-ish comparison of dotted numeric versions: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Version of the mtq-claim skill installed for each tool (null when not installed). */
export function installedSkillVersions(env: ToolEnv = process.env, home: string = homedir()): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(toolSkillDirs(env, home)).map(([tool, dir]) => [tool, skillsBundleVersion(dir)]),
  );
}
