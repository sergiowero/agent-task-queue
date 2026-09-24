import { describe, it, expect, beforeAll } from "bun:test";
import { createProject, getTaskById } from "./database.js";
import { buildTaskBrief } from "./brief.js";
import { checkDefinitionOfReady } from "./dor.js";
import { getHandoffs } from "./records.js";
import { TaskStatus } from "./catalog.js";
import {
  addUserComment,
  approvePlan,
  claimNextTask,
  createTaskForProject,
  reportBlocker,
  requestCodeChanges,
  resolveBlocker,
  submitCode,
  submitPlan,
  submitReview,
} from "./workflow.js";

process.env.AGENTQ_DB_PATH = ":memory:";

const coder = { toolName: "Coder", version: "1", model: "c", sessionId: "brief-coder" };
const reviewer = { toolName: "Reviewer", version: "1", model: "r", sessionId: "brief-reviewer" };
let n = 0;

function project(extra: Record<string, unknown> = {}) {
  const id = `brief-${Date.now()}-${n++}`;
  createProject({
    id,
    displayName: "Brief",
    workingDirectory: "/tmp/brief",
    autonomy: 1,
    profile: { commands: { test: "bun test" }, guardrails: ["No new dependencies"], conventionFiles: ["CLAUDE.md"], ...extra } as any,
  });
  return id;
}

describe("task brief", () => {
  let projectId: string;
  beforeAll(() => {
    projectId = project();
  });

  it("carries what the next agent needs: plan, criteria, findings, handoffs, round and human notes", () => {
    const task = createTaskForProject({
      title: "brief",
      description: "Users can export their data as CSV from the settings page.",
      projectId,
      requiresPlan: true,
      guardrails: ["Keep the API stable", "No new dependencies"],
      acceptanceCriteria: ["export works $ bun test export"],
      nonGoals: ["PDF export"],
      references: [{ label: "Design", target: "https://example.com/design" }],
    });
    let c = claimNextTask({ role: "planner", agent: coder, projectId })!;
    submitPlan(task.id, {
      message: "## Plan v1",
      claimToken: c.claimToken,
      context: "Start in src/export.ts",
      decisions: ["Stream rows"],
      risks: ["Large accounts"],
      next: ["Add the export test first"],
      validationPlan: { items: [{ criterionId: "AC1", how: "test", command: "bun test export" }], regressionCommands: ["bun test"] },
    });
    expect(buildTaskBrief(task.id)!.latestPlan).toBe("## Plan v1");
    approvePlan(task.id);

    c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    submitCode(task.id, { message: "## Code r1 MARKER-ROUND-1", worktree: "/w", claimToken: c.claimToken, context: "Look at the stream" });
    const r = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
    submitReview(task.id, {
      verdict: "request_changes",
      message: "one issue",
      claimToken: r.claimToken,
      context: "Fix R1-1",
      findings: [{ severity: "major", text: "No test for an empty account" }],
    });
    addUserComment(task.id, { message: "Also check the header row." });

    const brief = buildTaskBrief(task.id)!;
    expect(brief.task).toMatchObject({ nonGoals: ["PDF export"], references: [{ label: "Design" }] });
    expect(brief.guardrails).toEqual(["No new dependencies", "Keep the API stable"]);
    expect(brief.conventionFiles).toEqual(["CLAUDE.md"]);
    expect(brief.commands).toEqual({ test: "bun test" });
    expect(brief.approvedPlan?.markdown).toBe("## Plan v1");
    expect(brief.latestPlan).toBeNull();
    expect(brief.criteria[0]).toMatchObject({ id: "AC1" });
    expect(brief.openFindings.map((f) => f.id)).toEqual(["R1-1"]);
    expect(brief.handoffs.map((h) => [h.phase, h.summary])).toEqual([
      ["plan", "Start in src/export.ts"],
      ["code", "Look at the stream"],
      ["review", "Fix R1-1"],
    ]);
    expect(brief.handoffs[0]).toMatchObject({ decisions: ["Stream rows"], risks: ["Large accounts"], next: ["Add the export test first"] });
    expect(brief.humanNotes.map((h) => h.message)).toEqual(["Also check the header row."]);
    expect(brief.round).toMatchObject({ codeRound: 1, reviewRoundsUsed: 1, maxReviewRounds: 3, remainingReviewRounds: 2 });
    expect(brief.typeGuidance).toContain("tests");
    expect(JSON.stringify(brief)).not.toContain("MARKER-ROUND-1");
  });

  it("records people's change requests and answers as handoffs", () => {
    const projectId = project();
    const task = createTaskForProject({ title: "human", description: "A long enough description for readiness.", projectId });
    let c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    reportBlocker(task.id, { reason: "Unclear", question: "Which format?", claimToken: c.claimToken, context: "tried both" });
    resolveBlocker(task.id, { answer: "CSV only.", targetStatus: TaskStatus.ChangesRequested });
    expect(buildTaskBrief(task.id)!.lastAnswer).toBe("CSV only.");
    c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken });
    const r = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
    submitReview(task.id, { verdict: "approve", message: "ok", claimToken: r.claimToken });
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.Approved);
    const phases = getHandoffs(task.id).map((h) => [h.phase, h.summary]);
    expect(phases).toContainEqual(["code", "tried both"]);
    expect(phases).toContainEqual(["human", 'Answer to "Which format?": CSV only.']);
  });

  it("a person's change request reaches the coder as a human handoff", () => {
    const l0 = project();
    const task = createTaskForProject({ title: "l0", description: "A long enough description for readiness.", projectId: l0, autonomy: 0 });
    const c = claimNextTask({ role: "implementer", agent: coder, projectId: l0 })!;
    submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken });
    requestCodeChanges(task.id, { message: "Rename the flag." });
    expect(buildTaskBrief(task.id)!.handoffs.at(-1)).toMatchObject({ phase: "human", summary: "Rename the flag." });
    expect(buildTaskBrief(task.id)!.humanNotes.map((h) => h.message)).toEqual(["Rename the flag."]);
  });
});

describe("Definition of Ready", () => {
  it("flags short descriptions, missing or unverifiable criteria, unplanned high risk and bugs without steps", () => {
    expect(checkDefinitionOfReady({ description: "fix", type: "bug", risk: "high" })).toEqual([
      "The description is very short: say what should change and why.",
      "No acceptance criteria: say how anyone will know the task is done.",
      "High-risk tasks should require a plan, so a person approves the approach first.",
      "Bug without reproduction steps or expected vs. actual behaviour.",
    ]);
    expect(
      checkDefinitionOfReady({
        description: "Steps to reproduce: open settings; expected: saved; actual: lost.",
        type: "bug",
        acceptanceCriteria: ["saved $ bun test settings"],
      }),
    ).toEqual([]);
    expect(checkDefinitionOfReady({ description: "x".repeat(40), acceptanceCriteria: ["looks right"] })).toEqual([
      'No criterion says how it is verified: add a command ("text $ command") or a test for at least one.',
    ]);
  });

  it("warn stores the issues; enforce refuses the task; off skips the check", () => {
    const warn = project();
    expect(createTaskForProject({ title: "w", description: "short", projectId: warn }).dorIssues.length).toBeGreaterThan(0);
    const enforce = project({ dorMode: "enforce" });
    expect(() => createTaskForProject({ title: "e", description: "short", projectId: enforce })).toThrow("not ready");
    const off = project({ dorMode: "off" });
    expect(createTaskForProject({ title: "o", description: "short", projectId: off }).dorIssues).toEqual([]);
  });
});
