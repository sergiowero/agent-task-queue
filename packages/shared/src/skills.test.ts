import { describe, it, expect } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import { compareVersions, toolSkillDirs } from "./skills.js";

describe("skill folders", () => {
  it("each tool's skills folder follows the variable that moves its config folder", () => {
    expect(toolSkillDirs({}, "/h")).toEqual({
      claude: join("/h", ".claude", "skills"),
      opencode: join("/h", ".config", "opencode", "skills"),
      codex: join("/h", ".codex", "skills"),
      copilot: join("/h", ".copilot", "skills"),
      kimi: join("/h", ".kimi-code", "skills"),
      junie: join("/h", ".junie", "skills"),
    });
    expect(toolSkillDirs({ CODEX_HOME: "/x", CLAUDE_CONFIG_DIR: "/c", XDG_CONFIG_HOME: "/g", COPILOT_HOME: "/p" }, "/h")).toMatchObject({
      claude: join("/c", "skills"),
      copilot: join("/p", "skills"),
      codex: join("/x", "skills"),
      opencode: join("/g", "opencode", "skills"),
      kimi: join("/h", ".kimi-code", "skills"),
    });
    // An empty variable is unset.
    expect(toolSkillDirs({ CODEX_HOME: "", XDG_CONFIG_HOME: "" }, "/h").codex).toBe(join("/h", ".codex", "skills"));
    // Without arguments it reads the process environment and home folder.
    expect(toolSkillDirs().claude).toBe(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills"));
  });

  it("compares versions numerically", () => {
    expect(compareVersions("3.10.0", "3.9.1")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "3.2.0")).toBeLessThan(0);
    expect(compareVersions("3.2", "3.2.0")).toBe(0);
  });
});
