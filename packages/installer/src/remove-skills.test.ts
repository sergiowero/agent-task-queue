import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { removeSkills, type SkillsEnv } from "./remove-skills.js";

let root: string;

function touch(file: string, content = "{}") {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A machine with its own home folder and its tools' variables. */
function machine(name: string, env: SkillsEnv["env"] = {}): SkillsEnv {
  return { homeDir: join(root, name, "home"), env };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "moonlightq-skills-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const quiet = () => {};

describe("removeSkills", () => {
  it("removes every MoonlightQ skill copy and keeps everyone else's", () => {
    const e = machine("mixed");
    const skills = join(e.homeDir, ".claude", "skills");
    touch(join(skills, "moonlightq-claim", "SKILL.md"), "old");
    touch(join(skills, "moonlightq-code", "references", "one.md"), "old");
    touch(join(skills, "someone-elses", "SKILL.md"), "keep");
    touch(join(e.homeDir, ".junie", "skills", "moonlightq-claim", "SKILL.md"), "old");

    expect(removeSkills(e, quiet)).toBe(true);

    expect(existsSync(join(skills, "moonlightq-claim"))).toBe(false);
    expect(existsSync(join(skills, "moonlightq-code"))).toBe(false);
    expect(readFileSync(join(skills, "someone-elses", "SKILL.md"), "utf8")).toBe("keep");
    expect(existsSync(join(e.homeDir, ".junie", "skills", "moonlightq-claim"))).toBe(false);
  });

  it("looks in $CLAUDE_CONFIG_DIR, $CODEX_HOME and $XDG_CONFIG_HOME", () => {
    const [claude, codex, xdg] = ["c", "x", "g"].map((d) => join(root, "env", d));
    const e = machine("env", { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, XDG_CONFIG_HOME: xdg });
    for (const dir of [join(claude, "skills"), join(codex, "skills"), join(xdg, "opencode", "skills")]) {
      touch(join(dir, "moonlightq-claim", "SKILL.md"), "old");
    }

    removeSkills(e, quiet);

    for (const dir of [join(claude, "skills"), join(codex, "skills"), join(xdg, "opencode", "skills")]) {
      expect(existsSync(join(dir, "moonlightq-claim"))).toBe(false);
      expect(existsSync(dir)).toBe(true);
    }
  });

  it("removes a link to a skill folder and never touches what it points to", () => {
    const e = machine("link");
    const target = join(root, "link", "checkout", "moonlightq-a");
    touch(join(target, "SKILL.md"), "the folder the link pointed to");
    const skills = join(e.homeDir, ".claude", "skills");
    mkdirSync(skills, { recursive: true });
    symlinkSync(target, join(skills, "moonlightq-a"), process.platform === "win32" ? "junction" : "dir");

    removeSkills(e, quiet);

    expect(() => lstatSync(join(skills, "moonlightq-a"))).toThrow();
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("the folder the link pointed to");
  });

  it("makes no folder on a machine without any", () => {
    const lines: string[] = [];
    expect(removeSkills(machine("nothing"), (line) => lines.push(line))).toBe(true);
    expect(lines).toEqual([]);
    expect(existsSync(join(root, "nothing", "home"))).toBe(false);
  });
});
