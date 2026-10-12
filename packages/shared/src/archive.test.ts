import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  archiveStatusLabel,
  archiveTask,
  blockerVisits,
  buildArchiveDocuments,
  embedMarkdown,
  extractAgentSessions,
  findPullRequests,
  mergeRecordOf,
  parseMergeRecord,
} from "./archive.js";
import {
  createProject,
  createTask,
  getActivityEvents,
  getSubtasks,
  getTaskById,
  getTasks,
  patchTask,
  setAppState,
  updateTask,
} from "./database.js";
import type { ApprovedPlan, ConversationEntry, Evidence, Handoff, Task, Verification } from "./types.js";
import { TaskStatus } from "./types.js";
import { ALL_STATUSES, DEFAULT_ROLES, STATUS_INFO, type Role } from "./catalog.js";
import { forceStatus } from "./testing.js";
import {
  WorkflowError,
  approveCode,
  approvePlan,
  claimNextTask,
  completeFromPullRequest,
  completeTask as confirmCompletion,
  createSubtask,
  createTaskForProject,
  reportBlocker,
  requestAiReview,
  requestCodeChanges,
  resolveBlocker,
  submitCode,
  submitMerge,
  submitPlan,
  submitPlanReview,
  submitPr,
  submitRefinement,
  submitReview,
  submitVerification,
} from "./workflow.js";

// Set test DB before any DB access (the path is resolved lazily in getDb()).
process.env.AGENTQ_DB_PATH = ":memory:";

function entry(
  message: string,
  messageType: ConversationEntry["messageType"],
  at = 0,
): ConversationEntry {
  return {
    authorName: "agent",
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, at)).toISOString(),
    message,
    messageType,
  };
}

/** [phase, outcome] of every row of the summary's Agents table. */
function sessionRows(summary: string): string[][] {
  const agents = summary.split("\n## Agents")[1].split("\n## ")[0];
  return agents
    .split("\n")
    .filter((line) => /^\| \d+ \|/.test(line))
    .map((line) => {
      // | # | Phase | Agent | Claimed | Duration | Outcome |, agent ids escape their pipe.
      const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim());
      return [cells[2], cells[6]];
    });
}

/** The two documents of a task, as archived on 2026-01-02 with nothing but what is given. */
function documentsOf(task: Task, extra: Partial<Parameters<typeof buildArchiveDocuments>[0]> = {}) {
  return buildArchiveDocuments({
    task,
    project: null,
    agents: [],
    activity: [],
    archivedAt: "2026-01-02T03:04:05.000Z",
    summaryFile: "a.summary.md",
    detailedFile: "a.detailed.md",
    pullRequests: [],
    ...extra,
  });
}

describe("embedMarkdown", () => {
  it("demotes headings so the shallowest lands on the given level", () => {
    expect(embedMarkdown("## Plan\ntext\n### Steps\n# Top", 3)).toBe(
      "#### Plan\ntext\n##### Steps\n### Top",
    );
  });

  it("caps headings at h6 and leaves shallow-enough text untouched", () => {
    expect(embedMarkdown("# A\n###### B", 4)).toBe("#### A\n###### B");
    expect(embedMarkdown("#### Already deep", 3)).toBe("#### Already deep");
    expect(embedMarkdown("no headings\n#hashtag", 3)).toBe("no headings\n#hashtag");
  });

  it("never touches lines inside code fences and closes an unclosed fence", () => {
    const md = "## Title\n```bash\n# a comment\n```\n~~~\n# still code";
    expect(embedMarkdown(md, 4)).toBe(
      "#### Title\n```bash\n# a comment\n```\n~~~\n# still code\n~~~",
    );
  });
});

describe("findPullRequests", () => {
  it("finds PR URLs in the conversation after the explicit ones, without duplicates", () => {
    const entries = [
      entry(
        "see https://github.com/org/repo/pull/42 and https://github.com/org/repo/pull/42.",
        "merge",
      ),
      entry("MR: https://gitlab.com/g/p/-/merge_requests/7", "agent"),
    ];
    expect(findPullRequests(entries, ["https://github.com/org/repo/pull/1"])).toEqual([
      "https://github.com/org/repo/pull/1",
      "https://github.com/org/repo/pull/42",
      "https://gitlab.com/g/p/-/merge_requests/7",
    ]);
  });

  it("falls back to bare PR references when there is no URL", () => {
    expect(findPullRequests([entry("- **PR**: #12", "merge")])).toEqual(["#12"]);
    expect(findPullRequests([entry("nothing here", "merge")])).toEqual([]);
  });
});

describe("parseMergeRecord", () => {
  it("reads branch, commit, authors and worktree from the latest merge message", () => {
    const record = parseMergeRecord([
      entry("Merge submitted. Branch: old, Commit: 111, Authors: x", "merge", 1),
      entry(
        "Merge submitted. Branch: develop, Commit: abc123, Authors: dev1,dev2, Worktree: /w/t, Message: ## PR\n- url",
        "merge",
        2,
      ),
    ]);
    expect(record).toEqual({
      branch: "develop",
      commit: "abc123",
      authors: "dev1,dev2",
      worktree: "/w/t",
    });
    expect(parseMergeRecord([entry("hi", "agent")])).toBeNull();
  });
});

describe("mergeRecordOf", () => {
  it("prefers what submit_pr recorded on the PR, and falls back to the merge message of older tasks", () => {
    const conversation = [entry("PR opened: u. Branch: develop, Commit: abc1234, Authors: dev1, Worktree: /w/t", "merge", 1)];
    const old = { conversation, pullRequest: null } as unknown as Task;
    expect(mergeRecordOf(old)).toEqual({ branch: "develop", commit: "abc1234", authors: "dev1", worktree: "/w/t" });
    const recorded = { conversation, pullRequest: { base: "main", headSha: "fedcba9876543210", authors: "dev1, dev2" } } as unknown as Task;
    expect(mergeRecordOf(recorded)).toEqual({ branch: "main", commit: "fedcba9876543210", authors: "dev1, dev2", worktree: "/w/t" });
    expect(mergeRecordOf({ conversation: [], pullRequest: null } as unknown as Task)).toBeNull();
  });
});

describe("extractAgentSessions", () => {
  it("pairs each claim with the transition that ended it and its submission", () => {
    const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
    const task = {
      conversation: [
        {
          authorName: "a@1|m",
          timestamp: t(1),
          message: "Claimed task. Transitioning to coding.",
          messageType: "agent",
        },
        { authorName: "agent", timestamp: t(5), message: "## Changes", messageType: "code" },
        {
          authorName: "b@1|m",
          timestamp: t(8),
          message: "Claimed task. Transitioning to reviewing.",
          messageType: "agent",
        },
        { authorName: "system", timestamp: t(9), message: "Runner exited", messageType: "system" },
      ],
      history: [
        { pre_status: "ready_for_code", new_status: "coding", timestamp: t(1) },
        { pre_status: "coding", new_status: "waiting_code_review", timestamp: t(5) },
        { pre_status: "code_review_requested", new_status: "reviewing", timestamp: t(8) },
        { pre_status: "reviewing", new_status: "code_review_requested", timestamp: t(9) },
      ],
    } as unknown as Task;
    expect(extractAgentSessions(task)).toEqual([
      {
        agentId: "a@1|m",
        status: "coding",
        claimedAt: t(1),
        endedAt: t(5),
        endStatus: "waiting_code_review",
        claimIndex: 0,
        submissionIndex: 1,
        submitted: "Code submitted",
      },
      {
        agentId: "b@1|m",
        status: "reviewing",
        claimedAt: t(8),
        endedAt: t(9),
        endStatus: "code_review_requested",
        claimIndex: 2,
        submissionIndex: null,
        submitted: null,
      },
    ]);
  });
});

describe("archiveTask", () => {
  const root = mkdtempSync(join(tmpdir(), "agentq-archive-test-"));
  const projectDir = join(root, "project");
  const projectId = randomUUID();
  // Tasks that must never be claimed by completeTask() live in a second project.
  const sideProjectId = randomUUID();
  const agent = {
    toolName: "claude",
    version: "2.1.0",
    model: "opus",
    sessionId: "s-1",
    host: "box",
  };
  let task: Task;

  /** Takes a task through plan → code → review → merge → complete with the shared workflow. */
  function completeTask(title: string): Task {
    createTask({
      title,
      description: "## Goal\nUsers can switch theme.",
      steerDetails: "Use ThemeContext",
      guardrails: ["No new deps"],
      acceptanceCriteria: ["Toggle persists", "Works on mobile"],
      requiresPlan: true,
      projectId,
      contexts: ["created by test"],
    });
    const codex = { ...agent, toolName: "codex", model: "gpt", sessionId: "codex-session" };
    const claim = (who = agent) => claimNextTask({ roles: DEFAULT_ROLES, agent: who, projectId })!;
    let claimed = claim();
    const t = claimed.task;
    submitPlan(t.id, {
      message: "## Plan\n1. Add a toggle",
      author: "claude@2.1.0|opus",
      context: "plan ready",
      claimToken: claimed.claimToken,
      validationPlan: {
        items: [
          { criterionId: "AC1", how: "reload the page" },
          { criterionId: "AC2", how: "open it on a phone" },
        ],
        regressionCommands: [],
      },
    });
    approvePlan(t.id);
    claimed = claim(codex);
    submitCode(t.id, { message: "## Changes\n- Toggle in header", worktree: "/w/t", claimToken: claimed.claimToken });
    requestAiReview(t.id);
    claimed = claim();
    submitReview(t.id, { verdict: "approve", message: "Looks good. **Verdict:** approve", claimToken: claimed.claimToken });
    requestCodeChanges(t.id, { message: "Please fix contrast." });
    claimed = claim(codex);
    submitCode(t.id, {
      message: "## Changes\n- Fixed contrast",
      worktree: "/w/t",
      findingResolutions: [{ id: "H1-1", status: "fixed", resolution: "contrast fixed" }],
      claimToken: claimed.claimToken,
    });
    approveCode(t.id);
    claimed = claim();
    submitMerge(t.id, {
      branch: "develop",
      commit: "abc1234",
      authors: "codex@0.9|gpt,sergio",
      message: "## PR Created\n- **PR**: https://github.com/org/repo/pull/42",
      claimToken: claimed.claimToken,
    });
    return confirmCompletion(t.id);
  }

  beforeAll(() => {
    createProject({ id: projectId, displayName: "Archive Project", workingDirectory: projectDir, autonomy: 0 });
    createProject({ id: sideProjectId, displayName: "Side Project", workingDirectory: projectDir });
    mkdirSync(projectDir, { recursive: true });
    task = completeTask("Add dark mode toggle");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses tasks that are not complete", () => {
    const pending = createTask({ title: "Not done", description: "d", projectId: sideProjectId });
    expect(() => archiveTask(pending.id)).toThrow(WorkflowError);
    expect(() => archiveTask(pending.id)).toThrow("Only complete tasks can be archived");
    expect(() => archiveTask("missing-id")).toThrow("Task not found.");
  });

  it("writes a summary and a detailed record to {project}/archive and hides the task", () => {
    const result = archiveTask(task.id, { actor: "user", overview: "- Added the toggle." });

    expect(result.directory).toBe(join(projectDir, "archive"));
    expect(result.summaryPath).toMatch(
      /\d{4}-\d{2}-\d{2}-[0-9a-f]{8}-add-dark-mode-toggle\.summary\.md$/,
    );
    expect(result.detailedPath).toBe(result.summaryPath.replace(".summary.md", ".detailed.md"));
    expect(existsSync(result.summaryPath)).toBe(true);
    expect(existsSync(result.detailedPath)).toBe(true);
    expect(result.pullRequests).toEqual(["https://github.com/org/repo/pull/42"]);

    const summary = readFileSync(result.summaryPath, "utf8");
    expect(summary).toStartWith("# Add dark mode toggle\n");
    expect(summary).toContain("## Overview\n\n- Added the toggle.");
    expect(summary).toContain("## Description\n\n### Goal\nUsers can switch theme.");
    expect(summary).toContain("**AC1** Toggle persists");
    expect(summary).toContain("<https://github.com/org/repo/pull/42>");
    expect(summary).toContain(`**Branch:** \`${task.recommendedBranch}\``);
    expect(summary).toContain("**Commit:** `abc1234`");
    expect(summary).toContain("`claude@2.1.0|opus`, `codex@2.1.0|gpt`");
    expect(summary).toContain("1 plan, 2 code submissions, 1 AI review, 1 code change request");
    expect(summary).toContain("- Fixed contrast");
    expect(summary).toContain("_`agent` · ");
    expect(summary).toContain("latest of 2");
    // A person decides at L0: every submission went to a person, and the PR opened at the end.
    expect(sessionRows(summary)).toEqual([
      ["Planning", "Plan submitted → Waiting plan review"],
      ["Coding", "Code submitted → Waiting code review"],
      ["Review", "Review submitted → Waiting code review"],
      ["Coding", "Code submitted → Waiting code review"],
      ["Merge", "PR opened → PR open"],
    ]);
    expect(summary).not.toContain("Released without submitting");
    expect(summary).not.toContain("PR opened: https://github.com/org/repo/pull/42. Branch:");
    expect(summary).toContain("- **Base branch:** `develop`");
    // A person approved both, the plan is the one that was approved, and the project has nothing to verify with.
    expect(summary).toMatch(/- \*\*Plan approved by:\*\* a person \(`user`\) · \d{4}-\d{2}-\d{2} /);
    expect(summary).toMatch(/- \*\*Code approved by:\*\* a person \(`user`\) · \d{4}-\d{2}-\d{2} /);
    expect(summary).toContain("### Plan\n\n_Approved by a person (`user`) · ");
    expect(summary).toContain("### Verification\n\nNot verified: the project has no commands configured");
    // The AI review was of the first submission; the coder changed the code after it.
    expect(summary).toContain("(the code was submitted again after it)");

    const detailed = readFileSync(result.detailedPath, "utf8");
    expect(detailed).toStartWith("# Add dark mode toggle — full record\n");
    for (const text of [
      "Use ThemeContext",
      "1. No new deps",
      "created by test",
      "plan ready",
      "Please fix contrast.",
      "Looks good. **Verdict:** approve",
      "- Toggle in header",
      "PR opened: https://github.com/org/repo/pull/42. Branch: develop, Commit: abc1234",
      "`plan_submitted`",
      "`pr_opened`",
      "| claude | 2.1.0 | opus |",
      "Changes requested",
      '"id": "' + task.id + '"',
    ]) {
      expect(detailed).toContain(text);
    }

    const stored = getTaskById(task.id)!;
    expect(stored.archivedAt).toBe(result.task.archivedAt);
    expect(stored.archivePath).toBe(result.summaryPath);
    const last = stored.conversation[stored.conversation.length - 1];
    expect(last.messageType).toBe("system");
    expect(last.message).toContain("Task archived.");
    expect(getActivityEvents({ taskId: task.id }).map((e) => e.eventType)).toContain(
      "task_archived",
    );

    expect(getTasks(projectId).map((t) => t.id)).not.toContain(task.id);
    expect(getTasks(projectId, { includeArchived: true }).map((t) => t.id)).toContain(task.id);
  });

  it("refuses to archive twice unless forced, and force rewrites the same files", () => {
    const first = getTaskById(task.id)!;
    expect(() => archiveTask(task.id)).toThrow("Task is already archived");
    const again = archiveTask(task.id, {
      force: true,
      pullRequests: ["https://github.com/org/repo/pull/43"],
    });
    expect(again.summaryPath).toBe(first.archivePath!);
    expect(again.pullRequests[0]).toBe("https://github.com/org/repo/pull/43");
    expect(readFileSync(again.summaryPath, "utf8")).toContain("pull/43");
  });

  it("writes to an explicit directory and fails when the project folder is missing", () => {
    const other = completeTask("Second task");
    const dir = join(root, "custom");
    const result = archiveTask(other.id, { directory: dir });
    expect(result.directory).toBe(dir);
    expect(existsSync(result.detailedPath)).toBe(true);

    const ghostProject = randomUUID();
    createProject({ id: ghostProject, displayName: "Ghost", workingDirectory: join(root, "nope") });
    const ghost = createTask({ title: "Ghost", description: "d", projectId: ghostProject });
    updateTask(ghost.id, { status: TaskStatus.Complete });
    expect(() => archiveTask(ghost.id)).toThrow("Project working directory not found");
  });

  it("renders documents for a task with no agent activity", () => {
    const bare = createTask({ title: "Bare", description: "", projectId: sideProjectId });
    const docs = documentsOf({ ...bare, status: TaskStatus.Complete });
    expect(docs.summary).toContain("_No description._");
    expect(docs.summary).toContain("_No plan, code, review or merge submissions were recorded._");
    expect(docs.summary).toContain("_No agent claimed this task._");
    expect(docs.summary).toContain("[a.detailed.md](./a.detailed.md)");
    expect(docs.detailed).toContain("[a.summary.md](./a.summary.md)");
    expect(docs.detailed).toContain("Archived from AgentQ on 2026-01-02 03:04:05 UTC");
    expect(docs.detailed).toContain("_No messages._");
    // A task that left no records shows none of their sections, and names nobody who approved it.
    for (const section of ["Review findings", "Blockers and answers", "Verification", "Pull request", "Commits", "Handoffs", "Subtasks"]) {
      expect(docs.detailed).not.toContain(`## ${section}`);
    }
    expect(docs.detailed).toContain("## Approved plan\n\n_No plan was approved._");
    expect(docs.detailed).toContain("- **Code approved by:** —");
    expect(docs.summary).not.toContain("approved by:");
    expect(docs.summary).not.toContain("## Subtasks");
    expect(docs.summary).not.toContain("**Findings:**");
  });

  it("lists review findings with their id, severity and status", () => {
    const bare = createTask({ title: "Findings", description: "", projectId: sideProjectId });
    const finding = {
      id: "R1-1",
      taskId: bare.id,
      round: 1,
      phase: "code" as const,
      severity: "major" as const,
      file: "src/a.ts",
      line: 3,
      text: "No test for the empty list",
      status: "verified" as const,
      resolution: "Added a test",
      raisedBy: "reviewer",
      reopenCount: 1,
      createdAt: "t",
      updatedAt: "t",
    };
    const docs = documentsOf({ ...bare, status: TaskStatus.Complete }, { findings: [finding] });
    expect(docs.detailed).toContain("## Review findings");
    expect(docs.detailed).toContain("| `R1-1` | Code | major | verified (reopened ×1) | `src/a.ts:3` | `reviewer` | No test for the empty list | Added a test |");
    expect(docs.summary).toContain("- **Findings:** 1 (1 verified)");
  });
});

// ─── The policy-routed flow ────────────────────────────────────────────

/** What one agent session did, for a scripted task: claimed `status` from `from`, then the task went `to`. */
interface ScriptedClaim {
  status: string;
  from: string;
  to: string;
  /** What the session submitted; its message type is the phase's. */
  submits?: string;
  /** Who moved the task on: the agent itself (default), or the runner, the sweeper, a person... */
  actor?: string;
}

const SUBMISSION_TYPES: Record<string, NonNullable<ConversationEntry["messageType"]>> = {
  refining: "refine",
  planning: "plan",
  plan_reviewing: "plan_review",
  coding: "code",
  verifying: "verify",
  reviewing: "review",
  merging: "merge",
};

/** History and conversation of a task that went through the claims, a second apart (or all at once). */
function scripted(claims: ScriptedClaim[], sameMoment = false): Pick<Task, "conversation" | "history"> {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, sameMoment ? 0 : tick++)).toISOString();
  const conversation: Task["conversation"] = [];
  const history: Task["history"] = [];
  for (const claim of claims) {
    const agent = `${claim.status}-agent@1|m`;
    const claimedAt = now();
    history.push({ pre_status: claim.from, new_status: claim.status, timestamp: claimedAt, actor: agent });
    conversation.push({
      authorName: agent,
      timestamp: claimedAt,
      message: `Claimed task. Transitioning to ${claim.status}.`,
      messageType: "agent",
    });
    const endedAt = now();
    if (claim.submits) {
      conversation.push({ authorName: "agent", timestamp: endedAt, message: claim.submits, messageType: SUBMISSION_TYPES[claim.status] });
    }
    history.push({ pre_status: claim.status, new_status: claim.to, timestamp: endedAt, actor: claim.actor ?? agent });
  }
  return { conversation, history };
}

describe("what each agent session did", () => {
  const projectId = randomUUID();
  let bare: Task;

  beforeAll(() => {
    createProject({ id: projectId, displayName: "Sessions", workingDirectory: "/tmp/archive-sessions" });
    bare = createTask({ title: "Sessions", description: "", projectId });
  });

  /** The documents of a complete task that went through the script. */
  const render = (over: Partial<Task>) => documentsOf({ ...bare, status: TaskStatus.Complete, ...over });

  const PLAN: Pick<ScriptedClaim, "status" | "from"> = { status: "planning", from: "plan_requested" };
  const CRITIQUE: Pick<ScriptedClaim, "status" | "from"> = { status: "plan_reviewing", from: "plan_review_requested" };
  const CODE: Pick<ScriptedClaim, "status" | "from"> = { status: "coding", from: "ready_for_code" };
  const VERIFY: Pick<ScriptedClaim, "status" | "from"> = { status: "verifying", from: "verify_requested" };
  const REVIEW: Pick<ScriptedClaim, "status" | "from"> = { status: "reviewing", from: "code_review_requested" };
  const PR: Pick<ScriptedClaim, "status" | "from"> = { status: "merging", from: "approved" };

  // [what happened, the claim, the phase and outcome the summary shows]
  const cases: [string, ScriptedClaim, string, string][] = [
    ["a refined draft", { status: "refining", from: "draft", to: "plan_requested", submits: "## Refined" }, "Refinement", "Draft refined → Plan requested"],
    ["a draft that needs an answer", { status: "refining", from: "draft", to: "needs_human", submits: "?" }, "Refinement", "Draft refined → Needs human"],
    ["a plan an AI critic reads", { ...PLAN, to: "plan_review_requested", submits: "## Plan" }, "Planning", "Plan submitted → Plan critique requested"],
    ["a plan a person approves", { ...PLAN, to: "waiting_plan_review", submits: "## Plan" }, "Planning", "Plan submitted → Waiting plan review"],
    ["a plan with a blocking question", { ...PLAN, to: "needs_human", submits: "## Plan" }, "Planning", "Plan submitted → Needs human"],
    ["a critique that approves", { ...CRITIQUE, to: "ready_for_code", submits: "sound" }, "Plan critique", "Plan critique submitted → Ready for code"],
    ["a critique that approves a risky plan", { ...CRITIQUE, to: "waiting_plan_review", submits: "sound" }, "Plan critique", "Plan critique submitted → Waiting plan review"],
    ["a critique that asks for changes", { ...CRITIQUE, to: "plan_changes_requested", submits: "no" }, "Plan critique", "Plan critique submitted → Plan changes requested"],
    ["a critique that asks a person", { ...CRITIQUE, to: "needs_human", submits: "?" }, "Plan critique", "Plan critique submitted → Needs human"],
    ["code the verifier checks", { ...CODE, to: "verify_requested", submits: "## Changes" }, "Coding", "Code submitted → Verify requested"],
    ["code an AI reviews", { ...CODE, to: "code_review_requested", submits: "## Changes" }, "Coding", "Code submitted → AI review requested"],
    ["code a person reviews", { ...CODE, to: "waiting_code_review", submits: "## Changes" }, "Coding", "Code submitted → Waiting code review"],
    ["code with weakened tests", { ...CODE, to: "changes_requested", submits: "## Changes" }, "Coding", "Code submitted → Changes requested"],
    ["a verification that passed", { ...VERIFY, to: "code_review_requested", submits: "## Verification passed\n\n- ✅ `bun test`" }, "Verification", "Verification passed → AI review requested"],
    ["a verification that failed", { ...VERIFY, to: "changes_requested", submits: "## Verification failed\n\n- ❌ `bun test`" }, "Verification", "Verification failed → Changes requested"],
    ["a verification where nothing ran", { ...VERIFY, to: "waiting_code_review", submits: "## Verification skipped\n\nNot verified." }, "Verification", "Verification skipped → Waiting code review"],
    ["a verification that could not run", { ...VERIFY, to: "needs_human", submits: "**Verification could not run:** the worktree is gone" }, "Verification", "Verification could not run → Needs human"],
    ["a review that approves", { ...REVIEW, to: "approved", submits: "LGTM" }, "Review", "Review submitted → Approved"],
    ["a review that asks for changes", { ...REVIEW, to: "changes_requested", submits: "fix" }, "Review", "Review submitted → Changes requested"],
    ["a review of risky code", { ...REVIEW, to: "waiting_code_review", submits: "LGTM" }, "Review", "Review submitted → Waiting code review"],
    ["a review that asks a person", { ...REVIEW, to: "needs_human", submits: "?" }, "Review", "Review submitted → Needs human"],
    ["the pull request", { ...PR, to: "pr_open", submits: "PR opened: https://github.com/o/r/pull/1." }, "Merge", "PR opened → PR open"],
    ["a pull request on commits nobody reviewed", { ...PR, to: "needs_human", submits: "PR opened." }, "Merge", "PR opened → Needs human"],
    // A session that submitted nothing: how it ended says why.
    ["a runner that lost its job", { ...CODE, to: "ready_for_code", actor: "runner" }, "Coding", "Released without submitting (back to Ready for code)"],
    ["a claim that expired", { ...REVIEW, to: "code_review_requested", actor: "system:sweeper" }, "Review", "Released without submitting (back to AI review requested)"],
    ["an agent that reported a blocker", { ...CRITIQUE, to: "needs_human" }, "Plan critique", "Blocked (needs human)"],
    ["a task canceled meanwhile", { ...VERIFY, to: "canceled", actor: "user" }, "Verification", "Task canceled"],
  ];

  it("names the phase, what it submitted and where the policy sent the task, or why it let go", () => {
    for (const [name, claim, phase, outcome] of cases) {
      const docs = render(scripted([claim]));
      expect({ name, rows: sessionRows(docs.summary) }).toEqual({ name, rows: [[phase, outcome]] });
      // The full record says which message the submission is.
      expect(docs.detailed).toContain(claim.submits ? "| Message 2 |" : "| — |");
    }
    expect(cases.length).toBeGreaterThan(20);
  });

  it("a session still running has no end yet", () => {
    const running = scripted([{ ...CODE, to: "coding" }]);
    running.history.pop();
    expect(sessionRows(render(running).summary)).toEqual([["Coding", "No end recorded"]]);
  });

  it("every claim keeps its own end when sessions of one status ran in the same millisecond", () => {
    const task = scripted(
      [
        { ...CODE, to: "code_review_requested", submits: "## v1" },
        { status: "coding", from: "changes_requested", to: "changes_requested", actor: "runner" },
        { status: "coding", from: "changes_requested", to: "verify_requested", submits: "## v2" },
      ],
      true,
    );
    expect(extractAgentSessions(task as Task).map((s) => [s.endStatus, s.submitted])).toEqual([
      ["code_review_requested", "Code submitted"],
      ["changes_requested", null],
      ["verify_requested", "Code submitted"],
    ]);
  });

  it("has a label for every status of the catalog and a phase for every active one", () => {
    // A status added to the flow must not show up in an archive as its raw name or as a release.
    for (const status of ALL_STATUSES) {
      expect({ status, label: archiveStatusLabel(status) }).not.toEqual({ status, label: status.replace(/_/g, " ") });
    }
    const active: string[] = ALL_STATUSES.filter((s) => STATUS_INFO[s].kind === "active");
    expect([...active].sort()).toEqual(Object.keys(SUBMISSION_TYPES).sort());
    expect(new Set(cases.filter(([, claim]) => claim.submits).map(([, claim]) => claim.status))).toEqual(new Set(active));
  });

  it("lists a claim into a status it has no phase for, without inventing a submission", () => {
    const flow = scripted([{ status: "mystery_phase", from: "a", to: "b", submits: "text" }]);
    expect(sessionRows(render(flow).summary)).toEqual([["mystery phase", "Released without submitting (back to b)"]]);
  });

  it("counts critiques and verifications apart from plans, reviews and code", () => {
    const flow = scripted([
      { status: "refining", from: "draft", to: "plan_requested", submits: "## Refined" },
      { ...PLAN, to: "plan_review_requested", submits: "## Plan" },
      { ...CRITIQUE, to: "plan_changes_requested", submits: "no" },
      { ...PLAN, to: "plan_review_requested", submits: "## Plan v2" },
      { ...CRITIQUE, to: "ready_for_code", submits: "yes" },
      { ...CODE, to: "verify_requested", submits: "## Changes" },
      { ...VERIFY, to: "changes_requested", submits: "## Verification failed" },
      { ...CODE, to: "verify_requested", submits: "## Changes v2" },
      { ...VERIFY, to: "code_review_requested", submits: "## Verification passed" },
      { ...REVIEW, to: "approved", submits: "LGTM" },
    ]);
    expect(render(flow).summary).toContain(
      "- **Iterations:** 1 refinement, 2 plans, 2 plan critiques, 1 plan change request, 2 code submissions, 2 verifications, 1 AI review, 1 code change request",
    );
  });

  it("shows the sections of the phases that ran, and the latest verification record instead of an earlier report", () => {
    const flow = scripted([
      { status: "refining", from: "draft", to: "plan_requested", submits: "Refined with care" },
      { ...PLAN, to: "plan_review_requested", submits: "The plan" },
      { ...CRITIQUE, to: "ready_for_code", submits: "Sound plan" },
      // Round 1 passed; the round-2 code was never verified (the verifier was gone).
      { ...VERIFY, to: "code_review_requested", submits: "## Verification passed\n\n- ✅ `bun test`" },
    ]);
    const unverified: Verification = {
      round: 2,
      passed: false,
      skipped: true,
      note: "Not verified: the verifier is not running (waited 5 min).",
      tampering: [],
      tamperStrikes: 0,
      verifiedSha: null,
      at: "2026-01-01T00:00:09.000Z",
      evidenceIds: [],
    };
    const { summary } = render({ ...flow, verification: unverified });
    for (const heading of ["### Refinement", "### Plan\n", "### Plan critique", "### Verification"]) expect(summary).toContain(heading);
    expect(summary).toContain("Refined with care");
    expect(summary).toContain("Sound plan");
    expect(summary).toContain("### Verification\n\nNot verified: the verifier is not running (waited 5 min).");
    expect(summary).not.toContain("Passed");
    // The order is the flow's.
    const at = (heading: string) => summary.indexOf(heading);
    expect([at("### Refinement"), at("### Plan\n"), at("### Plan critique"), at("### Verification")]).toEqual(
      [at("### Refinement"), at("### Plan\n"), at("### Plan critique"), at("### Verification")].sort((a, b) => a - b),
    );
    // A task that was never verified (older tasks) has no such section.
    expect(render({ ...flow, verification: null }).summary).not.toContain("### Verification");
  });
});

describe("the records of the flow in the documents", () => {
  const root = mkdtempSync(join(tmpdir(), "agentq-archive-records-"));
  const projectId = randomUUID();
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  let bare: Task;

  beforeAll(() => {
    createProject({ id: projectId, displayName: "Records", workingDirectory: root });
    bare = createTask({ title: "Records", description: "", projectId });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const complete = (over: Partial<Task> = {}): Task => ({ ...bare, status: TaskStatus.Complete, ...over });

  it("names who approved the plan and the code, and which commit", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const plan = (approvedBy: string): ApprovedPlan => ({ markdown: "## Plan\n1. Build it", validation: null, approvedBy, at: at(2) });

    const agents = documentsOf(
      complete({ approvedPlan: plan("critic@1|gpt"), approval: { sha, by: "reviewer@1|gemini", human: false, round: 2, at: at(9) } }),
    );
    const critic = "- **Plan approved by:** the plan critic (`critic@1|gpt`) · 2026-01-01 00:00:02 UTC";
    const reviewer = "- **Code approved by:** the AI reviewer (`reviewer@1|gemini`, review 2) on `0123456789ab` · 2026-01-01 00:00:09 UTC";
    expect(agents.summary).toContain(critic);
    expect(agents.summary).toContain(reviewer);
    expect(agents.detailed).toContain(reviewer);

    const people = documentsOf(complete({ approvedPlan: plan("user"), approval: { sha, by: "user", human: true, round: 0, at: at(9) } }));
    expect(people.summary).toContain("- **Plan approved by:** a person (`user`) · 2026-01-01 00:00:02 UTC");
    expect(people.summary).toContain("- **Code approved by:** a person (`user`) on `0123456789ab` · 2026-01-01 00:00:09 UTC");
  });

  it("keeps the evidence and the handoffs, each on one row of its table", () => {
    const evidence: Evidence[] = [
      {
        id: "E1",
        taskId: bare.id,
        round: 1,
        kind: "command",
        criterionId: "AC1",
        command: "bun test | tee out.txt",
        exitCode: 1,
        summary: "2 fail\nexpected 1 | got 2",
        logPath: "/tmp/verify.log",
        producedBy: "coder@1|m",
        flaky: true,
        skipped: false,
        createdAt: at(1),
      },
      {
        id: "E2",
        taskId: bare.id,
        round: 2,
        kind: "manual",
        criterionId: null,
        command: null,
        exitCode: null,
        summary: "Opened the page on a phone",
        logPath: null,
        producedBy: "reviewer@1|r",
        flaky: false,
        skipped: false,
        createdAt: at(2),
      },
    ];
    const handoff = (over: Partial<Handoff>): Handoff => ({
      id: 1,
      taskId: bare.id,
      phase: "plan",
      round: 1,
      agentId: "planner@1|p",
      summary: "s",
      decisions: [],
      risks: [],
      next: [],
      createdAt: at(3),
      ...over,
    });
    const handoffs: Handoff[] = [
      handoff({ summary: "Two steps\nand a pipe | here", decisions: ["CSV only"], next: ["test the header", "wire the button"] }),
      handoff({ id: 2, phase: "human", round: 2, agentId: "user", summary: "Use the sandbox key", risks: ["slow"] }),
      handoff({ id: 3, phase: "legacy", round: 0, summary: "From before handoffs had phases" }),
    ];
    const { detailed } = documentsOf(complete(), { evidence, handoffs });

    // Nothing says the task was verified, but the commands that ran are listed.
    expect(detailed).toContain("## Verification\n\n_Not verified by AgentQ._");
    expect(detailed).toContain("| Id | Round | Criterion | Kind | Command | Exit code | Produced by | Notes | Output |");
    expect(detailed).toContain("| `E1` | 1 | AC1 | command | `bun test \\| tee out.txt` | 1 | `coder@1\\|m` | flaky, log `/tmp/verify.log` | 2 fail<br>expected 1 \\| got 2 |");
    expect(detailed).toContain("| `E2` | 2 | — | manual | — | — | `reviewer@1\\|r` | — | Opened the page on a phone |");

    expect(detailed).toContain("| Phase | Round | Agent | When | Summary | Decisions | Risks | Next |");
    expect(detailed).toContain("| Plan | 1 | `planner@1\\|p` | 2026-01-01 00:00:03 UTC | Two steps<br>and a pipe \\| here | - CSV only | — | - test the header<br>- wire the button |");
    expect(detailed).toContain("| Person | 2 | `user` | 2026-01-01 00:00:03 UTC | Use the sandbox key | — | - slow | — |");
    expect(detailed).toContain("| Earlier note | 0 | `planner@1\\|p` | 2026-01-01 00:00:03 UTC | From before handoffs had phases | — | — | — |");
  });

  it("lists the subtasks the task was split into, with their status and pull request", () => {
    const planner = { toolName: "planner", version: "1", model: "p", sessionId: "split-planner" };
    const pid = randomUUID();
    createProject({ id: pid, displayName: "Split", workingDirectory: root });
    const parent = createTask({ title: "Split me", description: "Export the data, then add a button for it.", projectId: pid, requiresPlan: true });
    const claimed = claimNextTask({ roles: ["plan"], agent: planner, projectId: pid })!;
    expect(claimed.task.id).toBe(parent.id);
    const sub = (title: string, blockedBy?: string[]) =>
      createSubtask(parent.id, { title, description: `${title}: the part of the export it owns.`, claimToken: claimed.claimToken, blockedBy });
    const backend = sub("Backend");
    const ui = sub("UI", [backend.id]);
    forceStatus(backend.id, TaskStatus.Complete, { claim: false });
    patchTask(backend.id, {
      pullRequest: { url: "https://github.com/org/repo/pull/5", number: 5, state: "merged", branch: "task/backend", mergedAt: at(3), mergedBy: "sergio", changesRequestedBy: [], checks: "success", checkedAt: at(3) },
    });
    forceStatus(ui.id, TaskStatus.Canceled, { claim: false });
    forceStatus(parent.id, TaskStatus.Complete, { claim: false });
    expect(getSubtasks(parent.id).map((c) => c.id)).toEqual([backend.id, ui.id]);

    const result = archiveTask(parent.id);
    const subtasks = [
      "## Subtasks",
      "",
      "| Id | Title | Status | Pull request |",
      "| --- | --- | --- | --- |",
      `| \`${backend.id}\` | Backend | Complete | <https://github.com/org/repo/pull/5> |`,
      `| \`${ui.id}\` | UI | Canceled | — |`,
    ].join("\n");
    expect(readFileSync(result.summaryPath, "utf8")).toContain(subtasks);
    expect(readFileSync(result.detailedPath, "utf8")).toContain(subtasks);
  });
});

describe("archiving a task that took the L2 path", () => {
  const root = mkdtempSync(join(tmpdir(), "agentq-archive-l2-"));
  const projectDir = join(root, "project");
  const projectId = randomUUID();
  const who = (name: string, model: string) => ({ toolName: name, version: "1", model, sessionId: `l2-${name}` });
  const refiner = who("refiner", "haiku");
  const planner = who("planner", "opus");
  const critic = who("critic", "gpt");
  const coder = who("coder", "sonnet");
  const reviewer = who("reviewer", "gemini");
  const opener = who("opener", "haiku");
  const verifier = { toolName: "agentq-verifier", version: "1", model: "none", sessionId: "builtin:verifier" };
  const DESCRIPTION = "Users can export their data as CSV from the settings page.";

  let taskId: string;
  let summary: string;
  let detailed: string;

  function claim(role: Role, agent: ReturnType<typeof who>) {
    const claimed = claimNextTask({ roles: [role], agent, projectId, ...(agent === verifier ? { runnerId: "builtin:verifier" } : {}) });
    expect(claimed?.task.id).toBe(taskId);
    return claimed!;
  }

  /** The verifier reports on the submitted code (its evidence is what the archive shows). */
  function verify(passed: boolean, sha: string, output: string) {
    const c = claim("verify", verifier);
    const ran = { kind: "command" as const, command: "bun test export", exitCode: passed ? 0 : 1, summary: output, criterionId: "AC1" };
    const skipped = { kind: "command" as const, command: "bun run lint", exitCode: null, summary: "not in the allowlist", skipped: true };
    return submitVerification(taskId, {
      passed,
      evidence: passed ? [ran, skipped] : [ran],
      verifiedSha: sha,
      diffStats: { files: 2, insertions: 30, deletions: 4 },
      claimToken: c.claimToken,
    });
  }

  function code(sha: string, extra: Partial<Parameters<typeof submitCode>[1]> = {}) {
    const c = claim("code", coder);
    return submitCode(taskId, { message: `## Changes\n- ${sha}`, worktree: "/w/l2", headSha: sha, branch: "task/export", claimToken: c.claimToken, ...extra });
  }

  /** Refine, plan, critique, code, verify, review, PR, merge: with a critic that asks for changes, a red verification, a review round and a blocker on the way. */
  function walk() {
    const draft = createTaskForProject({ title: "Export data as CSV", description: "rough idea", projectId, draft: true });
    taskId = draft.id;
    let c = claim("refine", refiner);
    submitRefinement(taskId, {
      message: "## Refined\nReady to plan.",
      claimToken: c.claimToken,
      description: DESCRIPTION,
      acceptanceCriteria: ["Header row $ bun test export", "Download button"],
      type: "feature",
      risk: "medium",
      requiresPlan: true,
      nonGoals: ["No XLSX"],
      context: "assumed CSV",
    });

    c = claim("plan", planner);
    submitPlan(taskId, {
      message: "## Plan\n1. Add the exporter",
      claimToken: c.claimToken,
      validationPlan: {
        items: [
          { criterionId: "AC1", how: "unit test", command: "bun test export", newTests: ["export.test.ts"] },
          { criterionId: "AC2", how: "look at the page" },
        ],
        regressionCommands: ["bun test"],
      },
      context: "plan v1",
      decisions: ["CSV only"],
      risks: ["big files"],
      next: ["test the header"],
    });
    c = claim("plan_review", critic);
    submitPlanReview(taskId, { verdict: "request_changes", message: "Needs the empty state", findings: [{ severity: "major", text: "The plan misses the empty state" }], claimToken: c.claimToken });
    c = claim("plan", planner);
    submitPlan(taskId, {
      message: "## Plan v2\n1. Add the exporter\n2. Handle no rows",
      claimToken: c.claimToken,
      validationPlan: {
        items: [
          { criterionId: "AC1", how: "unit test", command: "bun test export", newTests: ["export.test.ts"] },
          { criterionId: "AC2", how: "look at the page" },
        ],
        regressionCommands: ["bun test"],
      },
      findingResolutions: [{ id: "P1-1", status: "fixed", resolution: "Added the empty state" }],
    });
    c = claim("plan_review", critic);
    // Medium risk: the critic approves, and a person approves too.
    expect(submitPlanReview(taskId, { verdict: "approve", message: "Sound now", verifiedFindings: [{ id: "P1-1", status: "verified" }], claimToken: c.claimToken }).newStatus).toBe(TaskStatus.WaitingPlanReview);
    approvePlan(taskId);

    // The verifier is online while the code is submitted, so it checks it first.
    expect(
      code("1111111111111111", {
        evidence: [{ kind: "command", command: "bun test export", exitCode: 0, summary: "3 pass", criterionId: "AC1" }],
        context: "code v1",
      }).newStatus,
    ).toBe(TaskStatus.VerifyRequested);
    expect(verify(false, "1111111111111111", "1 fail: header missing").newStatus).toBe(TaskStatus.ChangesRequested);
    expect(code("2222222222222222").newStatus).toBe(TaskStatus.VerifyRequested);
    expect(verify(true, "2222222222222222", "3 pass").newStatus).toBe(TaskStatus.CodeReviewRequested);

    c = claim("review", reviewer);
    expect(
      submitReview(taskId, {
        verdict: "request_changes",
        message: "Rename the helper",
        findings: [{ severity: "major", text: "Rename x to rows", file: "src/export.ts", line: 3 }],
        claimToken: c.claimToken,
      }).newStatus,
    ).toBe(TaskStatus.ChangesRequested);

    c = claim("code", coder);
    reportBlocker(taskId, { reason: "The sandbox key is missing", question: "Which key should the tests use?", claimToken: c.claimToken });
    resolveBlocker(taskId, { answer: "Use the sandbox key", targetStatus: TaskStatus.ChangesRequested });
    expect(code("3333333333333333", { findingResolutions: [{ id: "R1-1", status: "fixed", resolution: "Renamed" }] }).newStatus).toBe(TaskStatus.VerifyRequested);
    verify(true, "3333333333333333", "3 pass");
    c = claim("review", reviewer);
    expect(submitReview(taskId, { verdict: "approve", message: "Good now", verifiedFindings: [{ id: "R1-1", status: "verified" }], claimToken: c.claimToken }).newStatus).toBe(TaskStatus.Approved);

    c = claim("pr", opener);
    submitPr(taskId, {
      prUrl: "https://github.com/org/repo/pull/9",
      branch: "main",
      commit: "3333333333333333",
      authors: "coder@1|sonnet",
      message: "The PR body",
      claimToken: c.claimToken,
    });
    const open = getTaskById(taskId)!;
    expect(open.status).toBe(TaskStatus.PrOpen);
    const mergedAt = new Date().toISOString();
    completeFromPullRequest(taskId, { ...open.pullRequest!, state: "merged", mergedAt, mergedBy: "sergio", checks: "success", checkedAt: mergedAt });
    expect(getTaskById(taskId)!.status).toBe(TaskStatus.Complete);
  }

  beforeAll(() => {
    createProject({ id: projectId, displayName: "L2 Project", workingDirectory: projectDir, autonomy: 2 });
    mkdirSync(projectDir, { recursive: true });
    try {
      setAppState("verifier_heartbeat", new Date().toISOString());
      walk();
    } finally {
      setAppState("verifier_heartbeat", new Date(0).toISOString());
    }
    const result = archiveTask(taskId);
    summary = readFileSync(result.summaryPath, "utf8");
    detailed = readFileSync(result.detailedPath, "utf8");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("shows every session with what it submitted and where the policy sent the task", () => {
    expect(sessionRows(summary)).toEqual([
      ["Refinement", "Draft refined → Plan requested"],
      ["Planning", "Plan submitted → Plan critique requested"],
      ["Plan critique", "Plan critique submitted → Plan changes requested"],
      ["Planning", "Plan submitted → Plan critique requested"],
      ["Plan critique", "Plan critique submitted → Waiting plan review"],
      ["Coding", "Code submitted → Verify requested"],
      ["Verification", "Verification failed → Changes requested"],
      ["Coding", "Code submitted → Verify requested"],
      ["Verification", "Verification passed → AI review requested"],
      ["Review", "Review submitted → Changes requested"],
      ["Coding", "Blocked (needs human)"],
      ["Coding", "Code submitted → Verify requested"],
      ["Verification", "Verification passed → AI review requested"],
      ["Review", "Review submitted → Approved"],
      ["Merge", "PR opened → PR open"],
    ]);
    expect(summary).not.toContain("Released without submitting");
    expect(summary).toContain(
      "- **Iterations:** 1 refinement, 2 plans, 2 plan critiques, 1 plan change request, 3 code submissions, 3 verifications, 2 AI reviews, 3 code change requests",
    );
    // The path the task really took, status by status.
    expect(summary).toContain("Draft → Refining → Plan requested → Planning → Plan critique requested → Plan critique → Plan changes requested");
    expect(summary).toContain("Coding → Needs human → Changes requested → Coding → Verify requested → Verifying");
    expect(summary).toContain("Approved → Merging → PR open → Complete");
  });

  it("says how the task was run and who approved what", () => {
    expect(summary).toContain("- **Autonomy:** L2 Human PR");
    expect(summary).toContain("- **Risk:** medium");
    expect(summary).toContain("- **Plan approved by:** a person (`user`)");
    expect(summary).toContain("- **Code approved by:** the AI reviewer (`reviewer@1|gemini`, review 2) on `333333333333`");
    expect(summary).toContain("- **Findings:** 2 (2 verified)");
    // The phases that ran each have their section; the verification is the latest record, with its commands.
    for (const heading of ["### Refinement", "### Plan\n", "### Plan critique", "### Implementation", "### Verification", "### Review", "### Merge"]) {
      expect(summary).toContain(heading);
    }
    expect(summary).toContain("### Verification\n\n✅ Passed (round 2) on `333333333333`.");
    expect(summary).toContain("- ✅ `bun test export` (AC1)");
    expect(summary).toContain("- ⏭ `bun run lint` — not in the allowlist");
    expect(summary).toContain("Latest AI verdict: **approve** in round 2 by `reviewer@1|gemini`");
    expect(summary).toContain("Good now");
    // The plan is the one that was approved (the critic turned the first down), not just the latest message.
    expect(summary).toMatch(/### Plan\n\n_Approved by a person \(`user`\) · [^\n]+ · 2 plans submitted_\n\n#### Plan v2\n1\. Add the exporter\n2\. Handle no rows/);
    expect(summary).not.toContain("#### Plan\n");
  });

  it("keeps the approved plan with its validation plan", () => {
    expect(detailed).toContain("## Approved plan\n\nApproved by a person (`user`)");
    expect(detailed).toContain("### Plan v2");
    expect(detailed).toContain("| AC1 | unit test | `bun test export` | `export.test.ts` |");
    expect(detailed).toContain("| AC2 | look at the page | — | — |");
    expect(detailed).toContain("Regression commands: `bun test`.");
    expect(detailed).toContain("- **Type:** feature");
    expect(detailed).toContain("- **Autonomy:** L2 Human PR");
    expect(detailed).toContain("## Non-goals\n\n- No XLSX");
  });

  it("keeps the evidence of the coder and the verifier, and the criteria it backs", () => {
    expect(detailed).toContain("## Verification\n\n✅ Passed (round 2) on `333333333333`.");
    expect(detailed).toContain("Diff: 2 files, +30 −4.");
    expect(detailed).toContain("| `E1` | 1 | AC1 | command | `bun test export` | 0 | `coder@1\\|sonnet` | — | 3 pass |");
    expect(detailed).toContain("| 1 | AC1 | command | `bun test export` | 1 | `runner:verify` | — | 1 fail: header missing |");
    expect(detailed).toContain("| `bun run lint` | — | `runner:verify` | skipped | not in the allowlist |");
    expect(detailed).toMatch(/\*\*AC1\*\* Header row — `bun test export` · evidence E1, /);
    // The summary lists the criteria and how they were checked; the evidence is in the full record.
    expect(summary).toContain("- ✅ **AC1** Header row — `bun test export`\n");
    expect(summary).not.toContain("evidence E");
  });

  it("labels the messages of every phase in the conversation", () => {
    for (const label of ["Refinement", "Plan", "Plan critique", "Code submission", "Verification", "Review", "Merge"]) {
      expect(detailed).toMatch(new RegExp(`### \\d+\\. ${label}\\n`));
    }
  });

  it("lists the findings of both critics with their answers", () => {
    expect(detailed).toContain("| `P1-1` | Plan | major | verified | — | `critic@1\\|gpt` | The plan misses the empty state | Added the empty state |");
    expect(detailed).toContain("| `R1-1` | Code | major | verified | `src/export.ts:3` | `reviewer@1\\|gemini` | Rename x to rows | Renamed |");
  });

  it("records the blocker and the person's answer", () => {
    const task = getTaskById(taskId)!;
    expect(blockerVisits(task)).toEqual([
      {
        at: expect.any(String),
        from: TaskStatus.Coding,
        by: "coder@1|sonnet",
        resolvedAt: expect.any(String),
        to: TaskStatus.ChangesRequested,
        resolvedBy: "user",
        answer: "Use the sandbox key",
      },
    ]);
    expect(detailed).toContain("## Blockers and answers");
    expect(detailed).toMatch(/\| 1 \| .* \| Coding \| `coder@1\\\|sonnet` \| .* \| Changes requested \| `user` \| Use the sandbox key \|/);
  });

  it("keeps the handoffs by phase and round, the commits and the pull request", () => {
    expect(detailed).toMatch(/\| Refinement \| 0 \| `refiner@1\\\|haiku` \| .* \| assumed CSV \| — \| — \| — \|/);
    expect(detailed).toMatch(/\| Plan \| 1 \| `planner@1\\\|opus` \| .* \| plan v1 \| - CSV only \| - big files \| - test the header \|/);
    expect(detailed).toMatch(/\| Code \| 1 \| `coder@1\\\|sonnet` \| .* \| code v1 \|/);
    expect(detailed).toContain('Answer to "Which key should the tests use?": Use the sandbox key');
    expect(detailed).toMatch(/\| Person \| \d \| `user` \|/);
    expect(detailed).toMatch(/\| 1 \| Code submitted \| `1111111111111111` \| `task\/export` \|/);
    expect(detailed).toMatch(/\| 1 \| Verified \| `1111111111111111` \|/);
    expect(detailed).toMatch(/\| 2 \| Code submitted \| `3333333333333333` \|/);
    expect(detailed).toMatch(/\| 2 \| Pull request head \| `3333333333333333` \|/);
    expect(detailed).toContain("- **Number:** #9");
    expect(detailed).toMatch(/- \*\*State:\*\* merged \(.* by `sergio`\)/);
    expect(detailed).toContain("- **Checks:** success");
    expect(detailed).toContain("- **AI reviews:** 2");
    expect(detailed).toContain("- **Plan critiques:** 2");
    expect(detailed).toContain('"evidence": [');
    expect(detailed).toContain('"handoffs": [');
  });
});
