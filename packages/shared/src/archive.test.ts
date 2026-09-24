import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  archiveTask,
  buildArchiveDocuments,
  embedMarkdown,
  extractAgentSessions,
  findPullRequests,
  parseMergeRecord,
} from "./archive.js";
import {
  createProject,
  createTask,
  getActivityEvents,
  getTaskById,
  getTasks,
  updateTask,
} from "./database.js";
import type { ConversationEntry, Task } from "./types.js";
import { TaskStatus } from "./types.js";
import {
  WorkflowError,
  approveCode,
  approvePlan,
  claimNextTask,
  completeTask as confirmCompletion,
  requestAiReview,
  requestCodeChanges,
  submitCode,
  submitMerge,
  submitPlan,
  submitReview,
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
      },
      {
        agentId: "b@1|m",
        status: "reviewing",
        claimedAt: t(8),
        endedAt: t(9),
        endStatus: "code_review_requested",
        claimIndex: 2,
        submissionIndex: null,
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
    const claim = (who = agent) => claimNextTask({ role: "senior", agent: who, projectId })!;
    let claimed = claim();
    const t = claimed.task;
    submitPlan(t.id, {
      message: "## Plan\n1. Add a toggle",
      author: "claude@2.1.0|opus",
      context: "plan ready",
      claimToken: claimed.claimToken,
    });
    approvePlan(t.id);
    claimed = claim(codex);
    submitCode(t.id, { message: "## Changes\n- Toggle in header", worktree: "/w/t", claimToken: claimed.claimToken });
    requestAiReview(t.id);
    claimed = claim();
    submitReview(t.id, { verdict: "approve", message: "Looks good. **Verdict:** approve", claimToken: claimed.claimToken });
    requestCodeChanges(t.id, { message: "Please fix contrast." });
    claimed = claim(codex);
    submitCode(t.id, { message: "## Changes\n- Fixed contrast", worktree: "/w/t", claimToken: claimed.claimToken });
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
    expect(summary).toContain("Merge recorded");
    expect(summary).not.toContain("Merge submitted. Branch:");

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
      "Merge submitted. Branch: develop, Commit: abc1234",
      "`plan_submitted`",
      "`merge_submitted`",
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
    const docs = buildArchiveDocuments({
      task: { ...bare, status: TaskStatus.Complete },
      project: null,
      agents: [],
      activity: [],
      archivedAt: "2026-01-02T03:04:05.000Z",
      summaryFile: "a.summary.md",
      detailedFile: "a.detailed.md",
      pullRequests: [],
    });
    expect(docs.summary).toContain("_No description._");
    expect(docs.summary).toContain("_No plan, code, review or merge submissions were recorded._");
    expect(docs.summary).toContain("_No agent claimed this task._");
    expect(docs.summary).toContain("[a.detailed.md](./a.detailed.md)");
    expect(docs.detailed).toContain("[a.summary.md](./a.summary.md)");
    expect(docs.detailed).toContain("Archived from AgentQ on 2026-01-02 03:04:05 UTC");
    expect(docs.detailed).toContain("_No messages._");
    expect(docs.detailed).not.toContain("## Review findings");
  });

  it("lists review findings with their id, severity and status", () => {
    const bare = createTask({ title: "Findings", description: "", projectId: sideProjectId });
    const docs = buildArchiveDocuments({
      task: { ...bare, status: TaskStatus.Complete },
      project: null,
      agents: [],
      activity: [],
      archivedAt: "2026-01-02T03:04:05.000Z",
      summaryFile: "a.summary.md",
      detailedFile: "a.detailed.md",
      pullRequests: [],
      findings: [
        {
          id: "R1-1",
          taskId: bare.id,
          round: 1,
          phase: "code",
          severity: "major",
          file: "src/a.ts",
          line: 3,
          text: "No test for the empty list",
          status: "verified",
          resolution: "Added a test",
          raisedBy: "reviewer",
          reopenCount: 1,
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });
    expect(docs.detailed).toContain("## Review findings");
    expect(docs.detailed).toContain("`R1-1`");
    expect(docs.detailed).toContain("verified (reopened ×1)");
    expect(docs.detailed).toContain("`src/a.ts:3`");
    expect(docs.detailed).toContain("_Added a test_");
  });
});
