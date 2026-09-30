import { describe, it, expect, beforeAll } from "bun:test";
import { createProject, getTaskById, setAppState } from "./database.js";
import { buildAgentBrief, buildTaskBrief, type IndependentBrief } from "./brief.js";
import { checkDefinitionOfReady } from "./dor.js";
import { getEvidence, getHandoffs } from "./records.js";
import { TaskStatus } from "./catalog.js";
import {
  addUserComment,
  approveCode,
  approvePlan,
  claimNextTask,
  createTaskForProject,
  postComment,
  reportBlocker,
  requestAiReview,
  requestCodeChanges,
  resolveBlocker,
  submitCode,
  submitPlan,
  submitPlanReview,
  submitRefinement,
  submitReview,
  submitVerification,
} from "./workflow.js";
import { forceStatus } from "./testing.js";

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
    profile: { commands: { test: "bun test" }, guardrails: ["No new dependencies"], ...extra } as any,
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
    let c = claimNextTask({ roles: ["plan"], agent: coder, projectId })!;
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

    c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    submitCode(task.id, { message: "## Code r1 MARKER-ROUND-1", worktree: "/w", claimToken: c.claimToken, context: "Look at the stream" });
    const r = claimNextTask({ roles: ["review"], agent: reviewer, projectId })!;
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

  it("shows the plan-critique and verification budgets, and a revising planner its own validation plan", () => {
    const l2 = `brief-budget-${Date.now()}`;
    createProject({ id: l2, displayName: "Budget", workingDirectory: "/tmp/brief", autonomy: 2 });
    const task = createTaskForProject({
      title: "budget",
      description: "Users can export their data as CSV from the settings page.",
      projectId: l2,
      requiresPlan: true,
      acceptanceCriteria: ["export works $ bun test export"],
    });
    expect(buildTaskBrief(task.id)!.round).toMatchObject({
      planRoundsUsed: 0,
      maxPlanRounds: 2,
      remainingPlanRounds: 2,
      verifyFailures: 0,
      maxVerifyFailures: 2,
      remainingVerifyFailures: 2,
    });
    const validationPlan = { items: [{ criterionId: "AC1", how: "test", command: "bun test export" }], regressionCommands: ["bun test"] };
    let c = claimNextTask({ roles: ["plan"], agent: coder, projectId: l2 })!;
    submitPlan(task.id, {
      message: "## Plan v1",
      claimToken: c.claimToken,
      context: "c",
      validationPlan,
      openQuestions: [{ text: "Dates in UTC?", blocking: false }],
      touchedPaths: ["src/export.ts"],
    });
    c = claimNextTask({ roles: ["plan_review"], agent: reviewer, projectId: l2 })!;
    submitPlanReview(task.id, {
      verdict: "request_changes",
      message: "m",
      claimToken: c.claimToken,
      context: "c",
      findings: [{ severity: "major", text: "no empty case" }],
    });
    claimNextTask({ roles: ["plan"], agent: coder, projectId: l2 });
    const revising = buildTaskBrief(task.id)!;
    expect(revising.round).toMatchObject({ planRound: 1, planRoundsUsed: 1, remainingPlanRounds: 1 });
    expect(revising.latestPlan).toBe("## Plan v1");
    expect(revising.validationPlan).toEqual(validationPlan);
    expect(revising.planSubmission).toMatchObject({ openQuestions: [{ text: "Dates in UTC?", blocking: false }], touchedPaths: ["src/export.ts"] });

    const coded = createTaskForProject({ title: "red", description: "Users can export their data as CSV.", projectId: l2 });
    const v = forceStatus(coded.id, TaskStatus.Verifying);
    submitVerification(coded.id, {
      passed: false,
      evidence: [{ kind: "command", command: "bun test", exitCode: 1, summary: "1 fail" }],
      claimToken: v.claimToken!,
    });
    const afterRed = buildTaskBrief(coded.id)!;
    expect(afterRed.round).toMatchObject({ verifyFailures: 1, maxVerifyFailures: 2, remainingVerifyFailures: 1 });
    expect(afterRed.validationPlan).toBeNull();
    expect(afterRed.planSubmission).toBeNull();
  });

  it("the task summary carries what still keeps a draft from being ready", () => {
    const task = createTaskForProject({ title: "rough", description: "export", projectId: project(), draft: true });
    expect(buildTaskBrief(task.id)!.task.dorIssues).toEqual(getTaskById(task.id)!.dorIssues);
    expect(buildTaskBrief(task.id)!.task.dorIssues.length).toBeGreaterThan(0);
  });

  it("a refinement and a plan critique are their own messages, never the plan", () => {
    const pid = project();
    const draft = createTaskForProject({ title: "draft", description: "export", projectId: pid, draft: true });
    let c = claimNextTask({ roles: ["refine"], agent: coder, projectId: pid })!;
    submitRefinement(draft.id, {
      message: "Refined: rewrote the criteria",
      claimToken: c.claimToken,
      description: "Users can export their data as CSV from the settings page.",
      acceptanceCriteria: ["export works $ bun test export"],
      context: "assumed CSV",
    });
    expect(getTaskById(draft.id)!.conversation.at(-1)?.messageType).toBe("refine");
    c = claimNextTask({ roles: ["code"], agent: coder, projectId: pid })!;
    expect(c.task.id).toBe(draft.id);
    expect(buildTaskBrief(draft.id)!.latestPlan).toBeNull();
    // Nothing to freeze: a task that never had a plan cannot have one approved.
    forceStatus(draft.id, TaskStatus.WaitingPlanReview, { claim: false });
    expect(() => approvePlan(draft.id)).toThrow("There is no plan to approve");
  });

  it("records people's change requests and answers as handoffs", () => {
    const projectId = project();
    const task = createTaskForProject({ title: "human", description: "A long enough description for readiness.", projectId });
    let c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    reportBlocker(task.id, { reason: "Unclear", question: "Which format?", claimToken: c.claimToken, context: "tried both" });
    resolveBlocker(task.id, { answer: "CSV only.", targetStatus: TaskStatus.ChangesRequested });
    expect(buildTaskBrief(task.id)!.lastAnswer).toBe("CSV only.");
    c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken });
    const r = claimNextTask({ roles: ["review"], agent: reviewer, projectId })!;
    submitReview(task.id, { verdict: "approve", message: "ok", claimToken: r.claimToken });
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.Approved);
    const phases = getHandoffs(task.id).map((h) => [h.phase, h.summary]);
    expect(phases).toContainEqual(["code", "tried both"]);
    expect(phases).toContainEqual(["human", 'Answer to "Which format?": CSV only.']);
  });

  it("a person's change request reaches the coder as a human handoff", () => {
    const l0 = project();
    const task = createTaskForProject({ title: "l0", description: "A long enough description for readiness.", projectId: l0, autonomy: 0 });
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId: l0 })!;
    submitCode(task.id, { message: "c", worktree: "/w", claimToken: c.claimToken });
    requestCodeChanges(task.id, { message: "Rename the flag." });
    expect(buildTaskBrief(task.id)!.handoffs.at(-1)).toMatchObject({ phase: "human", summary: "Rename the flag." });
    expect(buildTaskBrief(task.id)!.humanNotes.map((h) => h.message)).toEqual(["Rename the flag."]);
  });
});

describe("handoff rounds", () => {
  it("a submission and the check of it share a round: plan k and critique k, code k and review k (its evidence round)", () => {
    const pid = `brief-rounds-${Date.now()}`;
    createProject({ id: pid, displayName: "Rounds", workingDirectory: "/tmp/brief", autonomy: 2 });
    const planner = { toolName: "Planner", version: "1", model: "p", sessionId: "rounds-planner" };
    const critic = { toolName: "Critic", version: "1", model: "k", sessionId: "rounds-critic" };
    const task = createTaskForProject({
      title: "rounds",
      description: "Users can export their data as CSV from the settings page.",
      projectId: pid,
      requiresPlan: true,
      risk: "low",
      acceptanceCriteria: ["export works $ bun test export"],
    });
    const validationPlan = { items: [{ criterionId: "AC1", how: "test", command: "bun test export" }], regressionCommands: [] };
    const plan = (round: number, findingResolutions: { id: string; status: "fixed"; resolution: string }[] = []) => {
      const c = claimNextTask({ roles: ["plan"], agent: planner, projectId: pid })!;
      submitPlan(task.id, { message: `plan ${round}`, claimToken: c.claimToken, context: `plan ${round}`, validationPlan, findingResolutions });
    };
    const critique = (round: number, verdict: "approve" | "request_changes", extra: Record<string, unknown>) => {
      const c = claimNextTask({ roles: ["plan_review"], agent: critic, projectId: pid })!;
      submitPlanReview(task.id, { verdict, message: `critique ${round}`, claimToken: c.claimToken, context: `critique ${round}`, ...extra });
    };
    const code = (round: number, findingResolutions: { id: string; status: "fixed"; resolution: string }[] = []) => {
      const c = claimNextTask({ roles: ["code"], agent: coder, projectId: pid })!;
      submitCode(task.id, {
        message: `code ${round}`,
        worktree: "/w",
        claimToken: c.claimToken,
        context: `code ${round}`,
        evidence: [{ kind: "command", criterionId: "AC1", command: "bun test export", exitCode: 0, summary: "ok" }],
        findingResolutions,
      });
    };
    const review = (round: number, verdict: "approve" | "request_changes", extra: Record<string, unknown>) => {
      const c = claimNextTask({ roles: ["review"], agent: reviewer, projectId: pid })!;
      submitReview(task.id, { verdict, message: `review ${round}`, claimToken: c.claimToken, context: `review ${round}`, ...extra });
    };

    plan(1);
    critique(1, "request_changes", { findings: [{ severity: "major", text: "AC1 needs an empty-account case" }] });
    plan(2, [{ id: "P1-1", status: "fixed", resolution: "added" }]);
    critique(2, "approve", { verifiedFindings: [{ id: "P1-1", status: "verified" }] });
    code(1);
    review(1, "request_changes", { findings: [{ severity: "major", text: "no empty-account test" }] });
    code(2, [{ id: "R1-1", status: "fixed", resolution: "added" }]);
    review(2, "approve", { verifiedFindings: [{ id: "R1-1", status: "verified" }] });

    expect(getTaskById(task.id)!.status).toBe(TaskStatus.Approved);
    expect(getHandoffs(task.id).map((h) => [h.summary, h.round])).toEqual([
      ["plan 1", 1],
      ["critique 1", 1],
      ["plan 2", 2],
      ["critique 2", 2],
      ["code 1", 1],
      ["review 1", 1],
      ["code 2", 2],
      ["review 2", 2],
    ]);
    expect(getEvidence(task.id).map((e) => e.round)).toEqual([1, 2]);
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
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    submitCode(task.id, {
      message: "done",
      worktree: "/w",
      evidence: [{ kind: "command", criterionId: "AC1", command: "bun test export", exitCode: 0, summary: "1 pass" }],
      criteria: [{ id: "AC1", status: "met" }],
      claimToken: c.claimToken,
    });
    expect(buildTaskBrief(task.id)!.pr).toBeNull();
    const r = claimNextTask({ roles: ["review"], agent: reviewer, projectId })!;
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

  it("a person's approval over open blocker findings says so, and labels them as blocking", () => {
    const projectId = project();
    const task = createTaskForProject({ title: "override", description: "Rename the public export of the parser module.", projectId });
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    submitCode(task.id, { message: "done", worktree: "/w", claimToken: c.claimToken });
    const r = claimNextTask({ roles: ["review"], agent: reviewer, projectId })!;
    submitReview(task.id, {
      verdict: "needs_human",
      message: "not sure",
      question: "Is breaking the public API acceptable here?",
      findings: [
        { severity: "blocker", text: "Breaks public API" },
        { severity: "minor", text: "Typo in a comment" },
      ],
      claimToken: r.claimToken,
    });
    resolveBlocker(task.id, { answer: "Yes, it is a major release.", targetStatus: TaskStatus.Approved });

    const body = buildTaskBrief(task.id)!.pr!.body;
    expect(body).toContain("AI review: **needs_human** in round 1 by `reviewer@1|r`.");
    expect(body).toMatch(/Approved by a person \(`user`\) on \d{4}-\d{2}-\d{2}\./);
    expect(body).toContain("Open blocker/major findings a person accepted (`user`):\n- R1-1 (blocker) Breaks public API");
    expect(body).toContain("Still open (non-blocking):\n- R1-2 (minor) Typo in a comment");
    expect(body).not.toMatch(/Still open \(non-blocking\):[^#]*R1-1/);
  });

  it("an AI verdict on an earlier submission is marked as such", () => {
    const projectId = `brief-l0-${Date.now()}-${n++}`;
    createProject({ id: projectId, displayName: "Brief L0", workingDirectory: "/tmp/brief", autonomy: 0 });
    const task = createTaskForProject({ title: "stale", description: "Cache the parsed config between calls.", projectId });
    let c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    submitCode(task.id, { message: "r1", worktree: "/w", claimToken: c.claimToken });
    requestAiReview(task.id);
    const r = claimNextTask({ roles: ["review"], agent: reviewer, projectId })!;
    submitReview(task.id, { verdict: "request_changes", message: "one", findings: [{ severity: "minor", text: "Name it cache" }], claimToken: r.claimToken });
    expect(getTaskById(task.id)!.lastReview?.stale).toBeUndefined();

    // A person sends it back and approves the new submission without another AI review.
    requestCodeChanges(task.id, { message: "Use the shared helper" });
    c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    submitCode(task.id, {
      message: "r2",
      worktree: "/w",
      findingResolutions: [
        { id: "R1-1", status: "fixed", resolution: "renamed" },
        { id: "H1-1", status: "fixed", resolution: "uses it" },
      ],
      claimToken: c.claimToken,
    });
    expect(getTaskById(task.id)!.lastReview).toMatchObject({ verdict: "request_changes", stale: true });
    approveCode(task.id);

    const body = buildTaskBrief(task.id)!.pr!.body;
    expect(body).toContain("AI review: **request_changes** in round 1 by `reviewer@1|r`, on an earlier submission: not AI-reviewed since the last change.");
    expect(body).toContain("Approved by a person (`user`)");
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
    let c = claimNextTask({ roles: ["plan"], agent: coder, projectId })!;
    submitPlan(task.id, {
      message: "## Plan v1",
      claimToken: c.claimToken,
      context: "PLANNER-NOTE",
      decisions: ["PLANNER-DECISION"],
      risks: ["PLANNER-RISK"],
      validationPlan,
    });
    approvePlan(task.id);

    c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
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

    const r1 = claimNextTask({ roles: ["review"], agent: reviewer, projectId })!;
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
    c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
    reportBlocker(task.id, { reason: "CODER-BLOCKER reason", question: "CSV or XLSX?", claimToken: c.claimToken, context: "CODER-BLOCKER note" });
    resolveBlocker(task.id, { answer: "CSV only.", targetStatus: TaskStatus.ChangesRequested });
    c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
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

    const r2 = claimNextTask({ roles: ["review"], agent: reviewer, projectId })!;
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
    const c = claimNextTask({ roles: ["plan"], agent: coder, projectId })!;
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
    const critic = claimNextTask({ roles: ["plan_review"], agent: reviewer, projectId })!;
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
    const c = claimNextTask({ roles: ["code"], agent: coder, projectId })!;
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
    const v = claimNextTask({ roles: ["verify"], agent: reviewer, projectId })!;
    expect(v.task.status).toBe(TaskStatus.Verifying);
    const brief = buildAgentBrief(v.task) as IndependentBrief;
    expect(brief).toMatchObject({ independent: true, phase: "verify", commands: { test: "bun test" }, task: { worktreePath: "/w" } });
    expect(brief.criteria).toEqual([{ id: "AC1", text: "export works", verify: { kind: "command", command: "bun test export" } }]);
    expect(brief.openFindings).toEqual([]);
    expect(brief.verification).toBeNull();
    expect(leaks(brief)).toEqual([]);
  });
});
