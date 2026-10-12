import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { installedSkillVersions, toolSkillDirs } from "@moonlightq/shared/skills";
import { SKILL_TOOLS, installSkills, skillToolPresent, type SkillsEnv } from "./install-skills.js";

let root: string;
let source: string;

const skillMd = (version: string) => `---\nname: moonlightq-a\nmetadata:\n  version: "${version}"\n---\nbody`;

function touch(file: string, content = "{}") {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A machine with its own home folder, its tools' variables and no binaries on PATH. */
function machine(name: string, env: SkillsEnv["env"] = {}, which: SkillsEnv["which"] = () => null): SkillsEnv {
  return { homeDir: join(root, name, "home"), env, which };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "moonlightq-skills-"));
  source = join(root, "source");
  touch(join(source, "moonlightq-a", "SKILL.md"), skillMd("2.0.0"));
  touch(join(source, "moonlightq-a", "references", "one.md"), "reference");
  touch(join(source, "moonlightq-b", "SKILL.md"), skillMd("2.0.0"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const quiet = () => {};

describe("installSkills", () => {
  it("has a skills folder for exactly the tools it knows how to detect", () => {
    expect(Object.keys(SKILL_TOOLS).sort()).toEqual(Object.keys(toolSkillDirs()).sort());
  });

  it("writes to $CLAUDE_CONFIG_DIR, $CODEX_HOME and $XDG_CONFIG_HOME, and reports the versions from there", () => {
    const [claude, codex, xdg] = ["c", "x", "g"].map((d) => join(root, "env", d));
    const e = machine("env", { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, XDG_CONFIG_HOME: xdg });
    touch(join(claude, "settings.json"));
    touch(join(codex, "auth.json"));
    touch(join(xdg, "opencode", "package.json"));

    expect(installSkills(e, source, quiet)).toBe(true);

    expect(toolSkillDirs(e.env, e.homeDir)).toMatchObject({
      claude: join(claude, "skills"),
      codex: join(codex, "skills"),
      opencode: join(xdg, "opencode", "skills"),
    });
    for (const dir of [join(claude, "skills"), join(codex, "skills"), join(xdg, "opencode", "skills")]) {
      expect(readFileSync(join(dir, "moonlightq-a", "references", "one.md"), "utf8")).toBe("reference");
      expect(existsSync(join(dir, "moonlightq-b", "SKILL.md"))).toBe(true);
    }
    // The default folders are not used while a variable moves them.
    expect(existsSync(join(e.homeDir, ".claude"))).toBe(false);
    expect(existsSync(join(e.homeDir, ".codex"))).toBe(false);
    expect(existsSync(join(e.homeDir, ".config"))).toBe(false);
  });

  it("installedSkillVersions reads the same moved folders", () => {
    // Skills as an earlier bundle left them, in the folders a variable points to.
    const codex = join(root, "versions", "codex");
    touch(join(codex, "skills", "moonlightq-claim", "SKILL.md"), skillMd("1.2.3"));
    const versions = installedSkillVersions({ CODEX_HOME: codex }, join(root, "versions", "home"));
    expect(versions.codex).toBe("1.2.3");
    expect(versions.claude).toBeNull();
    expect(versions.opencode).toBeNull();
  });

  it("leaves a tool alone unless its binary, its own data or an earlier skills folder is there", () => {
    const e = machine("absent");
    touch(join(e.homeDir, ".codex", "config.toml"));
    // Only a folder an earlier install made: it keeps being refreshed.
    touch(join(e.homeDir, ".junie", "skills", "moonlightq-a", "SKILL.md"), skillMd("1.0.0"));
    expect(skillToolPresent("claude", e)).toBe(false);
    expect(skillToolPresent("kimi", e)).toBe(false);
    expect(skillToolPresent("codex", e)).toBe(true);
    expect(skillToolPresent("junie", e)).toBe(true);
    // A binary on PATH is enough, whatever its folder holds.
    expect(skillToolPresent("kimi", { ...e, which: (bin) => (bin === "kimi" ? "/usr/bin/kimi" : null) })).toBe(true);
    expect(skillToolPresent("unknown-tool", e)).toBe(false);

    expect(installSkills(e, source, quiet)).toBe(true);

    expect(existsSync(join(e.homeDir, ".codex", "skills", "moonlightq-a", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(e.homeDir, ".junie", "skills", "moonlightq-a", "SKILL.md"), "utf8")).toBe(skillMd("2.0.0"));
    for (const dir of [".claude", ".kimi-code", ".config"]) expect(existsSync(join(e.homeDir, dir))).toBe(false);
  });

  it("refreshes an existing skills folder, alongside other people's skills, without making any other tool's", () => {
    const e = machine("only-skills");
    touch(join(e.homeDir, ".kimi-code", "skills", "someone-elses", "SKILL.md"), "x");
    expect(installSkills(e, source, quiet)).toBe(true);
    expect(existsSync(join(e.homeDir, ".kimi-code", "skills", "moonlightq-a", "SKILL.md"))).toBe(true);
    expect(existsSync(join(e.homeDir, ".kimi-code", "skills", "someone-elses", "SKILL.md"))).toBe(true);
    expect(existsSync(join(e.homeDir, ".junie"))).toBe(false);
  });

  it("replaces each skill folder as a whole: a file the skill dropped does not linger", () => {
    const e = machine("replace");
    touch(join(e.homeDir, ".claude", "settings.json"));
    const installed = join(e.homeDir, ".claude", "skills", "moonlightq-a");
    touch(join(installed, "SKILL.md"), skillMd("1.0.0"));
    touch(join(installed, "dropped.md"), "an older bundle shipped it");
    touch(join(installed, "references", "gone.md"), "an older bundle shipped it");

    installSkills(e, source, quiet);

    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe(skillMd("2.0.0"));
    expect(existsSync(join(installed, "dropped.md"))).toBe(false);
    expect(existsSync(join(installed, "references", "gone.md"))).toBe(false);
    expect(existsSync(join(installed, "references", "one.md"))).toBe(true);
  });

  it("replaces a link to a skill folder with a copy and never touches what it points to", () => {
    const e = machine("link");
    touch(join(e.homeDir, ".claude", "settings.json"));
    const target = join(root, "link", "checkout", "moonlightq-a");
    touch(join(target, "SKILL.md"), "the folder the link pointed to");
    const skills = join(e.homeDir, ".claude", "skills");
    mkdirSync(skills, { recursive: true });
    symlinkSync(target, join(skills, "moonlightq-a"), process.platform === "win32" ? "junction" : "dir");

    installSkills(e, source, quiet);

    expect(lstatSync(join(skills, "moonlightq-a")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(skills, "moonlightq-a", "SKILL.md"), "utf8")).toBe(skillMd("2.0.0"));
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("the folder the link pointed to");
  });

  it("removes MoonlightQ skills the bundle dropped and keeps everyone else's", () => {
    const e = machine("obsolete");
    touch(join(e.homeDir, ".claude", "settings.json"));
    const skills = join(e.homeDir, ".claude", "skills");
    touch(join(skills, "moonlightq-retired", "SKILL.md"), "old");
    touch(join(skills, "someone-elses", "SKILL.md"), "keep");

    installSkills(e, source, quiet);

    expect(existsSync(join(skills, "moonlightq-retired"))).toBe(false);
    expect(readFileSync(join(skills, "someone-elses", "SKILL.md"), "utf8")).toBe("keep");
  });

  it("says so when no tool is found, and fails only when there are no skills to copy", () => {
    const lines: string[] = [];
    expect(installSkills(machine("nothing"), source, (line) => lines.push(line))).toBe(true);
    expect(lines.some((line) => line.includes("No coding tool with a skills folder found"))).toBe(true);
    expect(existsSync(join(root, "nothing", "home"))).toBe(false);

    expect(installSkills(machine("nothing"), join(root, "no-such-source"), (line) => lines.push(line))).toBe(false);
  });
});
