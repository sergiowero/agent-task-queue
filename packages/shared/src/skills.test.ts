import { describe, it, expect } from "bun:test";
import {
  MIN_COMPATIBLE_SKILLS_VERSION,
  SKILL_PREFIX,
  compareVersions,
  readSkill,
  skillVersion,
  skillsBundleVersion,
  skillsManifest,
  stripFrontmatter,
} from "./skills.js";

describe("skills bundle", () => {
  it("every agentq-* skill carries the bundle version", () => {
    const bundle = skillsBundleVersion();
    expect(bundle).toBeTruthy();
    const manifest = skillsManifest();
    const names = Object.keys(manifest).filter((n) => n.startsWith(SKILL_PREFIX));
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) {
      expect({ name, version: manifest[name] }).toEqual({ name, version: bundle });
    }
  });

  it("the bundle is at least the minimum version the server accepts", () => {
    expect(compareVersions(skillsBundleVersion()!, MIN_COMPATIBLE_SKILLS_VERSION)).toBeGreaterThanOrEqual(0);
  });

  it("reads a skill body without its frontmatter", () => {
    const skill = readSkill("agentq-claim")!;
    expect(skill.body.startsWith("---")).toBe(false);
    expect(skill.body).toContain("claim_task");
    expect(readSkill("agentq-does-not-exist")).toBeNull();
  });

  it("parses versions and compares them numerically", () => {
    expect(skillVersion('---\nname: x\nmetadata:\n  version: "3.10.0"\n---\nbody')).toBe("3.10.0");
    expect(skillVersion("no frontmatter")).toBeNull();
    expect(stripFrontmatter("---\na: 1\n---\nbody")).toBe("body");
    expect(compareVersions("3.10.0", "3.9.1")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "3.2.0")).toBeLessThan(0);
    expect(compareVersions("3.2", "3.2.0")).toBe(0);
  });
});
