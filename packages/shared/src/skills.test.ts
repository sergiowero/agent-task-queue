import { describe, it, expect } from "bun:test";
import {
  MIN_COMPATIBLE_SKILLS_VERSION,
  SKILL_PREFIX,
  compareVersions,
  listSkills,
  readSkill,
  skillVersion,
  skillsBundleVersion,
  skillsManifest,
  stripFrontmatter,
} from "./skills.js";
import { createProject, patchTask } from "./database.js";
import { TaskStatus } from "./catalog.js";
import { buildIndependentBrief, buildTaskBrief, INDEPENDENT_PHASES } from "./brief.js";
import { createTaskForProject } from "./workflow.js";
import { forceStatus } from "./testing.js";

process.env.AGENTQ_DB_PATH = ":memory:";

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

describe("skills read what the claim result and the brief carry", () => {
  const bodies = listSkills().map((name) => ({ name, body: readSkill(name)!.body }));

  it("no skill sends an agent to task fields the claim result leaves out", () => {
    for (const { name, body } of bodies) {
      const stale = body.match(/\btask\.(findings|evidence|conversation|contexts|history)\b|pre_status/g) ?? [];
      expect({ name, stale }).toEqual({ name, stale: [] });
    }
    const code = readSkill("agentq-code")!.body;
    expect(code).toContain("brief.openFindings");
    expect(code).toContain("brief.verification.failing");
    expect(readSkill("agentq-plan")!.body).toContain("findingResolutions");
  });

  it("every brief.<path> a skill names exists in the brief", () => {
    const projectId = `skills-${Date.now()}`;
    createProject({ id: projectId, displayName: "Skills", workingDirectory: "/tmp/skills" });
    const task = createTaskForProject({
      title: "skills",
      description: "Users can export their data as CSV from the settings page.",
      projectId,
      acceptanceCriteria: ["export works $ bun test export"],
    });
    patchTask(task.id, {
      verification: { round: 1, passed: true, skipped: false, note: null, tampering: [], tamperStrikes: 0, verifiedSha: null, at: new Date().toISOString() },
    });
    // Approved: the brief carries the PR body too.
    const approved = forceStatus(task.id, TaskStatus.Approved, { claim: false }).task;
    const briefs: unknown[] = [buildTaskBrief(approved)!, ...INDEPENDENT_PHASES.map((phase) => buildIndependentBrief(approved, phase)!)];

    const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
    let checked = 0;
    for (const { name, body } of bodies) {
      for (const [, path] of body.matchAll(/\bbrief\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g)) {
        let values = briefs;
        for (const key of path.split(".")) {
          const objects = values.filter(isObject);
          if (objects.length === 0) break; // a list, a string or null: nothing deeper to check
          const holders = objects.filter((o) => key in o);
          expect({ name, path, key, found: holders.length > 0 }).toEqual({ name, path, key, found: true });
          values = holders.map((o) => o[key]);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
