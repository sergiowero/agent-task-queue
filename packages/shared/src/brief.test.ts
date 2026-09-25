import { describe, it, expect, beforeAll } from "bun:test";
import { createProject, getTaskById, setAppState } from "./database.js";
import { buildAgentBrief, buildTaskBrief, type IndependentBrief } from "./brief.js";
import { checkDefinitionOfReady } from "./dor.js";
import { getHandoffs } from "./records.js";
import { TaskStatus } from "./catalog.js";
import {
  addUserComment,
  approvePlan,
  claimNextTask,
  createTaskForProject,
  postComment,
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

describe("pull request body", () => {
  it("is in the brief once the code is approved: criteria with evidence, verification, review and risk", () => {
    const projectId = project();
    const task = createTaskForProject({
      title: "pr body",
      description: "Users can export their data as CSV from the settings page.\n\nMore detail.",
      projectId,
      acceptanceCriteria: ["export works $ bun test export"],
      nonGoals: ["PDF export"],
    });
    const c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    submitCode(task.id, {
      message: "done",
      worktree: "/w",
      evidence: [{ kind: "command", criterionId: "AC1", command: "bun test export", exitCode: 0, summary: "1 pass" }],
      criteria: [{ id: "AC1", status: "met" }],
      claimToken: c.claimToken,
    });
    expect(buildTaskBrief(task.id)!.pr).toBeNull();
    const r = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
    submitReview(task.id, {
      verdict: "approve",
      message: "ok",
      findings: [{ severity: "nit", text: "rename x" }],
      claimToken: r.claimToken,
    });
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.Approved);

    const pr = buildTaskBrief(task.id)!.pr!;
    expect(pr.url).toBeNull();
    expect(pr.body).toStartWith("## Summary\n\nUsers can export their data as CSV from the settings page.\n");
    expect(pr.body).toContain("- ✅ **AC1** export works — `bun test export` passed");
    expect(pr.body).toContain("## Verification");
    expect(pr.body).toContain("AI review: **approve** in round 1");
    expect(pr.body).toContain("Still open (non-blocking):\n- R1-1 (nit) rename x");
    expect(pr.body).toContain("## Risk\n\n**medium**");
    expect(pr.body).toContain("Out of scope: PDF export");
    expect(pr.body).toContain(`AgentQ task \`${task.id}\``);
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

describe("independent checks", () => {
  /** Everything the authors wrote for the next agent: none of it may reach a checker. */
  const AUTHOR_CONTEXT = [
    "PLANNER-NOTE",
    "PLANNER-DECISION",
    "PLANNER-RISK",
    "CODER-NOTE",
    "CODER-MESSAGE",
    "CODER-DECISION",
    "CODER-RISK",
    "CODER-NEXT",
    "CODER-EVIDENCE",
    "CODER-COMMENT",
    "CODER-FIX",
    "CODER-BLOCKER",
    "REVIEWER-NOTE",
  ];
  const leaks = (brief: unknown) => AUTHOR_CONTEXT.filter((marker) => JSON.stringify(brief).includes(marker));
  const validationPlan = { items: [{ criterionId: "AC1", how: "test", command: "bun test export" }], regressionCommands: ["bun test"] };

  it("the code reviewer gets the task and what to check, never the coder's context", () => {
    const projectId = project();
    const task = createTaskForProject({
      title: "independent review",
      description: "Users can export their data as CSV from the settings page.",
      projectId,
      requiresPlan: true,
      guardrails: ["Keep the API stable"],
      acceptanceCriteria: ["export works $ bun test export"],
      nonGoals: ["PDF export"],
    });
    let c = claimNextTask({ role: "planner", agent: coder, projectId })!;
    submitPlan(task.id, {
      message: "## Plan v1",
      claimToken: c.claimToken,
      context: "PLANNER-NOTE",
      decisions: ["PLANNER-DECISION"],
      risks: ["PLANNER-RISK"],
      validationPlan,
    });
    approvePlan(task.id);

    c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    postComment(task.id, { message: "CODER-COMMENT" });
    submitCode(task.id, {
      message: "## Code CODER-MESSAGE",
      worktree: "/w",
      headSha: "abc123",
      claimToken: c.claimToken,
      context: "CODER-NOTE",
      decisions: ["CODER-DECISION"],
      risks: ["CODER-RISK"],
      next: ["CODER-NEXT"],
      evidence: [{ kind: "command", criterionId: "AC1", command: "bun test export", exitCode: 0, summary: "CODER-EVIDENCE" }],
      criteria: [{ id: "AC1", status: "met" }],
    });

    const r1 = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
    expect(r1.task.status).toBe(TaskStatus.Reviewing);
    const first = buildAgentBrief(r1.task) as IndependentBrief;
    expect(first).toMatchObject({ independent: true, phase: "review", task: { headSha: "abc123", worktreePath: "/w" } });
    expect(leaks(first)).toEqual([]);
    submitReview(task.id, {
      verdict: "request_changes",
      message: "two issues",
      claimToken: r1.claimToken,
      context: "REVIEWER-NOTE",
      findings: [
        { severity: "major", file: "src/export.ts", line: 3, text: "No test for an empty account" },
        { severity: "minor", text: "Rename the flag" },
      ],
    });

    // Round 2: the coder asks a person, answers the findings and resubmits.
    c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    reportBlocker(task.id, { reason: "CODER-BLOCKER reason", question: "CSV or XLSX?", claimToken: c.claimToken, context: "CODER-BLOCKER note" });
    resolveBlocker(task.id, { answer: "CSV only.", targetStatus: TaskStatus.ChangesRequested });
    c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    submitCode(task.id, {
      message: "## Code r2 CODER-MESSAGE",
      worktree: "/w",
      headSha: "def456",
      claimToken: c.claimToken,
      context: "CODER-NOTE r2",
      findingResolutions: [
        { id: "R1-1", status: "fixed", resolution: "CODER-FIX: added the empty-account test" },
        { id: "R1-2", status: "wontfix", resolution: "The flag name is public API" },
      ],
    });
    addUserComment(task.id, { message: "Check the header row too." });

    const r2 = claimNextTask({ role: "reviewer", agent: reviewer, projectId })!;
    const brief = buildAgentBrief(r2.task) as IndependentBrief;
    expect(brief.task).toMatchObject({
      description: "Users can export their data as CSV from the settings page.",
      nonGoals: ["PDF export"],
      headSha: "def456",
    });
    expect(brief.guardrails).toEqual(["No new dependencies", "Keep the API stable"]);
    expect(brief.commands).toEqual({ test: "bun test" });
    // The criteria and how to check them, without the coder's "met".
    expect(brief.criteria).toEqual([{ id: "AC1", text: "export works", verify: { kind: "command", command: "bun test export" } }]);
    expect(brief.approvedPlan).toMatchObject({ markdown: "## Plan v1", validation: validationPlan });
    expect(brief.latestPlan).toBeNull();
    // Findings to verify by id: a wontfix keeps its reason (to judge it), a fix claim keeps nothing.
    expect(brief.openFindings).toEqual([
      { id: "R1-1", round: 1, severity: "major", file: "src/export.ts", line: 3, text: "No test for an empty account", status: "fixed" },
      {
        id: "R1-2",
        round: 1,
        severity: "minor",
        file: null,
        line: null,
        text: "Rename the flag",
        status: "wontfix",
        wontfixReason: "The flag name is public API",
      },
    ]);
    expect(brief.humanDecisions.map((d) => d.decision)).toEqual(['Answer to "CSV or XLSX?": CSV only.']);
    expect(brief.humanNotes.map((h) => h.message)).toEqual(["Check the header row too."]);
    expect(brief.isolation).toContain(`git diff ${task.mergeBranch}...HEAD`);
    expect(brief).not.toHaveProperty("handoffs");
    expect(brief).not.toHaveProperty("lastAnswer");
    expect(leaks(brief)).toEqual([]);

    // The coder of the next round still gets the full brief, with every handoff.
    submitReview(task.id, {
      verdict: "request_changes",
      message: "m",
      claimToken: r2.claimToken,
      context: "REVIEWER-NOTE r2",
      verifiedFindings: [{ id: "R1-1", status: "open" }],
    });
    const next = buildAgentBrief(task.id)!;
    expect("independent" in next).toBe(false);
    expect(JSON.stringify(next)).toContain("REVIEWER-NOTE r2");
  });

  it("the plan critic gets the plan and the task, never the planner's handoff", () => {
    const projectId = project();
    const task = createTaskForProject({
      title: "independent critique",
      description: "Users can export their data as CSV from the settings page.",
      projectId,
      requiresPlan: true,
      autonomy: 2,
      acceptanceCriteria: ["export works $ bun test export"],
    });
    const c = claimNextTask({ role: "planner", agent: coder, projectId })!;
    submitPlan(task.id, {
      message: "## Plan to critique",
      claimToken: c.claimToken,
      context: "PLANNER-NOTE",
      decisions: ["PLANNER-DECISION"],
      risks: ["PLANNER-RISK"],
      validationPlan,
      touchedPaths: ["src/export.ts"],
      openQuestions: [{ text: "Dates in UTC?", blocking: false }],
    });
    const critic = claimNextTask({ role: "plan_reviewer", agent: reviewer, projectId })!;
    expect(critic.task.status).toBe(TaskStatus.PlanReviewing);
    const brief = buildAgentBrief(critic.task) as IndependentBrief;
    expect(brief).toMatchObject({ independent: true, phase: "plan_review", latestPlan: "## Plan to critique", validationPlan });
    expect(brief.planSubmission).toMatchObject({ touchedPaths: ["src/export.ts"], openQuestions: [{ text: "Dates in UTC?" }] });
    expect(brief.approvedPlan).toBeNull();
    expect(brief.verification).toBeNull();
    expect(brief.isolation).toContain("Independent critique");
    expect(leaks(brief)).toEqual([]);
  });

  it("the verifier gets the criteria, the plan and the commands, never the coder's evidence", () => {
    const projectId = project();
    const task = createTaskForProject({
      title: "independent verification",
      description: "Users can export their data as CSV from the settings page.",
      projectId,
      acceptanceCriteria: ["export works $ bun test export"],
    });
    const c = claimNextTask({ role: "implementer", agent: coder, projectId })!;
    // The verifier is online only for this submit: other tests expect code to go straight to review.
    setAppState("verifier_heartbeat", new Date().toISOString());
    try {
      submitCode(task.id, {
        message: "## Code CODER-MESSAGE",
        worktree: "/w",
        claimToken: c.claimToken,
        context: "CODER-NOTE",
        evidence: [{ kind: "command", criterionId: "AC1", command: "bun test export", exitCode: 0, summary: "CODER-EVIDENCE" }],
        criteria: [{ id: "AC1", status: "met" }],
      });
    } finally {
      setAppState("verifier_heartbeat", new Date(0).toISOString());
    }
    const v = claimNextTask({ role: "verifier", agent: reviewer, projectId })!;
    expect(v.task.status).toBe(TaskStatus.Verifying);
    const brief = buildAgentBrief(v.task) as IndependentBrief;
    expect(brief).toMatchObject({ independent: true, phase: "verify", commands: { test: "bun test" }, task: { worktreePath: "/w" } });
    expect(brief.criteria).toEqual([{ id: "AC1", text: "export works", verify: { kind: "command", command: "bun test export" } }]);
    expect(brief.openFindings).toEqual([]);
    expect(brief.verification).toBeNull();
    expect(leaks(brief)).toEqual([]);
  });
});
