import { beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "crypto";

process.env.AGENTQ_DB_PATH = ":memory:";

import { TaskStatus } from "./catalog.js";
import { addActivityEvent, createProject, createTask, patchTask } from "./database.js";
import { computeMetrics } from "./metrics.js";
import type { StatusHistoryEntry } from "./types.js";

const projectId = randomUUID();
const otherProjectId = randomUUID();

const hours = (base: string, h: number) => new Date(new Date(base).getTime() + h * 3_600_000).toISOString();

/** A task with a given status path (hours after creation) and activity rows. */
function seed(
  title: string,
  path: [TaskStatus, number][],
  events: [string, string, string?][] = [],
  codeRound = 0,
  inProject = projectId,
) {
  const task = createTask({ title, description: "d", projectId: inProject });
  let previous: string = task.status;
  const history: StatusHistoryEntry[] = path.map(([status, h]) => {
    const entry = { pre_status: previous, new_status: status, timestamp: hours(task.createdAt, h), actor: "agent" };
    previous = status;
    return entry;
  });
  patchTask(task.id, { history, codeRound, status: path.at(-1)?.[0] ?? task.status });
  for (const [eventType, actor, details] of events) addActivityEvent({ eventType, taskId: task.id, actor, details });
  return task.id;
}

beforeAll(() => {
  createProject({ id: projectId, displayName: "Metrics", workingDirectory: "/tmp/metrics" });
  createProject({ id: otherProjectId, displayName: "Metrics other", workingDirectory: "/tmp/metrics-other" });

  // Agents only: PR after one review round, merged 2 hours after creation.
  seed("agents only", [[TaskStatus.PrOpen, 1], [TaskStatus.Complete, 2]], [["review_submitted", "agent", "approve"]], 1);
  // A person approved the plan before the PR, and the task went through needs_human.
  seed(
    "with a person",
    [[TaskStatus.NeedsHuman, 0.5], [TaskStatus.PrOpen, 1]],
    [["plan_approved", "user"], ["comment_added", "user"]],
    2,
  );
  // The AI approved, then a person sent it back; the runner reverted twice.
  seed(
    "sent back",
    [[TaskStatus.WaitingCodeReview, 1]],
    [["review_submitted", "agent", "approve"], ["code_changes_requested", "user"], ["task_reverted", "runner"], ["task_reverted", "runner"]],
  );
  // Nothing happened yet.
  seed("idle", []);
  // Another project: left out by the project filter.
  seed("elsewhere", [[TaskStatus.PrOpen, 1]], [["plan_approved", "user"]], 5, otherProjectId);
});

describe("computeMetrics", () => {
  it("measures how much of a project's flow ran without a person", () => {
    const m = computeMetrics({ projectId });
    expect(m).toEqual({
      tasks: 4,
      // plan_approved + code_changes_requested; comments are not decisions.
      humanClicksPerTask: 0.5,
      reachedPr: 2,
      reachedPrWithoutHuman: 0.5,
      reviewRoundsAtPr: 1.5,
      escalationRate: 0.25,
      humanRejectionAfterAiApproval: 0.5,
      revertsPerTask: 0.5,
      leadTimeHours: 2,
      completed: 1,
    });
  });

  it("counts a PR's GitHub change requests as a rejection after an AI approval", () => {
    const pid = randomUUID();
    createProject({ id: pid, displayName: "Metrics gh", workingDirectory: "/tmp/metrics-gh" });
    const id = seed("gh changes", [[TaskStatus.PrOpen, 1]], [["review_submitted", "agent", "approve"]], 1, pid);
    patchTask(id, {
      pullRequest: {
        url: "u",
        number: 1,
        state: "open",
        branch: "b",
        mergedAt: null,
        mergedBy: null,
        changesRequestedBy: ["reviewer"],
        checks: null,
        checkedAt: null,
      },
    });
    expect(computeMetrics({ projectId: pid }).humanRejectionAfterAiApproval).toBe(1);
  });

  it("treats the old merged status as reaching the PR", () => {
    const pid = randomUUID();
    createProject({ id: pid, displayName: "Metrics legacy", workingDirectory: "/tmp/metrics-legacy" });
    seed("legacy", [["merged" as TaskStatus, 1]], [], 1, pid);
    expect(computeMetrics({ projectId: pid }).reachedPr).toBe(1);
  });

  it("filters by creation date and reports zeros for an empty range", () => {
    const m = computeMetrics({ projectId, to: "2000-01-01T00:00:00.000Z" });
    expect(m.tasks).toBe(0);
    expect(m.humanClicksPerTask).toBe(0);
    expect(m.leadTimeHours).toBeNull();
    expect(computeMetrics({ projectId, from: "2000-01-01T00:00:00.000Z" }).tasks).toBe(4);
  });
});
