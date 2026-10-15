import { describe, it, expect } from "bun:test";
import { createProject, patchTask, TaskStatus, buildIndependentBrief, buildTaskBrief, INDEPENDENT_PHASES, createTaskForProject, compareVersions, ALL_STATUSES, STATUS_INFO, skillForPhase } from "@moonlightq/shared";
import { forceStatus } from "@moonlightq/shared/testing";
import { MIN_COMPATIBLE_PHASES_VERSION, PHASES_VERSION, listPhases, readPhase } from "./phases/index.js";

process.env.MOONLIGHTQ_DB_PATH = ":memory:";

const readSkill = readPhase;
const listSkills = listPhases;

describe("skills the MCP server ships", () => {
  it("ships every phase's skill, plus claim, create-task and archive", () => {
    const phases = new Set(ALL_STATUSES.map((s) => STATUS_INFO[s].phase).filter((p) => p !== null));
    for (const phase of phases) expect(listPhases()).toContain(skillForPhase(phase!));
    for (const name of ["moonlightq-claim", "moonlightq-create-task", "moonlightq-archive"]) expect(listPhases()).toContain(name);
  });

  it("is at least the minimum version claim_task accepts, and the claim skill names it", () => {
    expect(compareVersions(PHASES_VERSION, MIN_COMPATIBLE_PHASES_VERSION)).toBeGreaterThanOrEqual(0);
    const claim = readPhase("moonlightq-claim").body;
    for (const [, version] of claim.matchAll(/"skillsVersion": "(\d[\d.]*)"/g)) expect(version).toBe(PHASES_VERSION);
    expect(claim).toContain(`\`${PHASES_VERSION}\``);
  });

  it("reads every skill as Markdown without frontmatter, and refuses unknown names", () => {
    for (const name of listPhases()) {
      const skill = readPhase(name);
      expect({ name, version: skill.version, frontmatter: skill.body.startsWith("---") }).toEqual({ name, version: PHASES_VERSION, frontmatter: false });
      expect(skill.body.length).toBeGreaterThan(500);
    }
    expect(() => readPhase("moonlightq-does-not-exist")).toThrow("Unknown skill");
  });

  it("the coder branches from the fetched merge branch, where its dependencies' work is", () => {
    const body = readSkill("moonlightq-code")!.body;
    const fetch = body.indexOf("git fetch origin {task.mergeBranch}");
    const create = body.indexOf("git worktree add -b {task.recommendedBranch} {project}/.moonlightq/worktrees/{task.id} origin/{task.mergeBranch}");
    expect(fetch).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(fetch);
    expect(body).toContain("brief.dependencies");
  });

});

describe("skills read what the claim result and the brief carry", () => {
  const bodies = listSkills().map((name) => ({ name, body: readSkill(name)!.body }));

  it("no skill sends an agent to task fields the claim result leaves out", () => {
    for (const { name, body } of bodies) {
      const stale = body.match(/\btask\.(findings|evidence|conversation|contexts|history)\b|pre_status/g) ?? [];
      expect({ name, stale }).toEqual({ name, stale: [] });
    }
    const code = readSkill("moonlightq-code")!.body;
    expect(code).toContain("brief.openFindings");
    expect(code).toContain("brief.verification.failing");
    expect(readSkill("moonlightq-plan")!.body).toContain("findingResolutions");
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
