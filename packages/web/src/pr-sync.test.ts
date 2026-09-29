import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

process.env.AGENTQ_DB_PATH = ":memory:";

import type { AutonomyLevel, PolicySettings, ProjectProfile, PullRequest, Risk } from "@agentq/shared";
import { TaskStatus, cancelTask, createProject, createTask, getActivityEvents, getTaskById, patchTask } from "@agentq/shared";
import { forceStatus } from "@agentq/shared/testing";
import type { GhResult, GhRunner } from "./pr-sync";
import { PrSync, ghRunner, parsePullRequest, prRef, syncPullRequests } from "./pr-sync";

const root = mkdtempSync(join(tmpdir(), "agentq-pr-sync-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function project(opts: { autonomy?: AutonomyLevel; policy?: Partial<PolicySettings>; profile?: Partial<ProjectProfile> } = {}) {
  const id = randomUUID();
  createProject({ id, displayName: `PR sync ${id.slice(0, 6)}`, workingDirectory: root, ...opts });
  return id;
}

function prOpenTask(projectId: string, opts: { risk?: Risk; pr?: Partial<PullRequest> | null } = {}) {
  const task = createTask({ title: "pr task", description: "d", projectId, risk: opts.risk ?? "medium" });
  forceStatus(task.id, TaskStatus.PrOpen, { claim: false });
  if (opts.pr !== null) {
    patchTask(task.id, {
      pullRequest: {
        url: "https://github.com/org/repo/pull/7",
        number: 7,
        state: "open",
        branch: "feat/x",
        mergedAt: null,
        mergedBy: null,
        changesRequestedBy: [],
        checks: null,
        checkedAt: null,
        ...opts.pr,
      },
    });
  }
  return task.id;
}

const ok = (json: object): GhResult => ({ exitCode: 0, stdout: JSON.stringify(json), stderr: "" });

/** A fake `gh` answering `pr view` per task ref and recording every call. */
function fakeGh(views: Record<string, GhResult | object>, merge: GhResult = { exitCode: 0, stdout: "", stderr: "" }) {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    if (args[1] === "merge") return merge;
    const view = views[args[2]];
    if (!view) return { exitCode: 1, stdout: "", stderr: `no pull requests found for ${args[2]}` };
    return "exitCode" in view ? (view as GhResult) : ok(view);
  };
  return { gh, calls };
}

const open = (extra: object = {}) => ({ state: "OPEN", url: "https://github.com/org/repo/pull/7", number: 7, headRefName: "feat/x", ...extra });

describe("parsePullRequest", () => {
  it("reads state, merger, change requests and checks", () => {
    const pr = parsePullRequest(
      {
        state: "OPEN",
        url: "u",
        number: 3,
        headRefName: "feat/y",
        reviews: [
          { state: "APPROVED", author: { login: "a" } },
          { state: "CHANGES_REQUESTED", author: { login: "b" } },
          { state: "CHANGES_REQUESTED", author: { login: "b" } },
        ],
        statusCheckRollup: [{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: "" }],
      },
      null,
      "now",
    );
    expect(pr).toMatchObject({ state: "open", number: 3, branch: "feat/y", changesRequestedBy: ["b"], checks: "pending", checkedAt: "now" });
    expect(parsePullRequest({ state: "MERGED", mergedBy: { login: "m" }, statusCheckRollup: [{ state: "SUCCESS" }, { conclusion: "SKIPPED" }] }, null, "t")).toMatchObject({
      state: "merged",
      mergedBy: "m",
      checks: "success",
    });
    expect(parsePullRequest({ state: "CLOSED", statusCheckRollup: [{ conclusion: "FAILURE" }] }, null, "t")).toMatchObject({ state: "closed", checks: "failure" });
    expect(parsePullRequest({ state: "OPEN" }, null, "t").checks).toBeNull();
  });

  it("uses each reviewer's latest review: an approval after a change request clears it, a comment does not", () => {
    const review = (login: string, state: string, submittedAt: string) => ({ author: { login }, state, submittedAt });
    const parse = (reviews: object[], previous: PullRequest | null = null) => parsePullRequest({ state: "OPEN", reviews }, previous, "t");

    const approved = parse([review("b", "CHANGES_REQUESTED", "2026-09-01T10:00:00Z"), review("b", "APPROVED", "2026-09-01T11:00:00Z")]);
    expect(approved.changesRequestedBy).toEqual([]);
    expect(approved.changesEverRequestedBy).toEqual(["b"]);

    const commented = parse([review("b", "CHANGES_REQUESTED", "2026-09-01T10:00:00Z"), review("b", "COMMENTED", "2026-09-01T11:00:00Z")]);
    expect(commented.changesRequestedBy).toEqual(["b"]);

    // Out of order from gh: the submission time decides.
    const reordered = parse([review("c", "APPROVED", "2026-09-01T12:00:00Z"), review("c", "CHANGES_REQUESTED", "2026-09-01T13:00:00Z")]);
    expect(reordered.changesRequestedBy).toEqual(["c"]);

    // A dismissed review stops blocking; the earlier sync already counted it for the metric.
    const dismissed = parse([review("d", "DISMISSED", "2026-09-01T10:00:00Z")], commented);
    expect(dismissed.changesRequestedBy).toEqual([]);
    expect(dismissed.changesEverRequestedBy).toEqual(["b"]);
  });

  it("finds the PR by URL, then number, then branch", () => {
    const id = prOpenTask(project());
    const task = getTaskById(id)!;
    expect(prRef(task)).toBe("https://github.com/org/repo/pull/7");
    expect(prRef({ ...task, pullRequest: { ...task.pullRequest!, url: null } })).toBe("7");
    expect(prRef({ ...task, pullRequest: null, realBranch: "feat/real" })).toBe("feat/real");
    expect(prRef({ ...task, pullRequest: null, realBranch: null })).toBe(task.recommendedBranch);
  });
});

describe("syncPullRequests", () => {
  it("completes a task whose PR was merged on GitHub, crediting the merger", async () => {
    const id = prOpenTask(project());
    const url = "https://github.com/org/repo/pull/7";
    const { gh } = fakeGh({ [url]: open({ state: "MERGED", mergedAt: "2026-09-24T10:00:00Z", mergedBy: { login: "alice" } }) });
    const result = await syncPullRequests({ gh });
    expect(result.merged).toContain(id);
    const task = getTaskById(id)!;
    expect(task.status).toBe(TaskStatus.Complete);
    expect(task.pullRequest).toMatchObject({ state: "merged", mergedBy: "alice" });
    expect(task.history.at(-1)).toMatchObject({ pre_status: TaskStatus.PrOpen, new_status: TaskStatus.Complete, actor: "github:alice" });
    expect(getActivityEvents({ taskId: id }).map((e) => e.eventType)).toContain("pr_merged");
    expect(task.archivedAt).toBeNull();
  });

  it("archives the merged task when the project archives automatically", async () => {
    const id = prOpenTask(project({ profile: { autoArchive: true } }), { pr: { url: "https://github.com/org/repo/pull/70", number: 70 } });
    const { gh } = fakeGh({ "https://github.com/org/repo/pull/70": open({ state: "MERGED", url: "https://github.com/org/repo/pull/70", number: 70 }) });
    await syncPullRequests({ gh });
    const task = getTaskById(id)!;
    expect(task.status).toBe(TaskStatus.Complete);
    expect(task.archivedAt).not.toBeNull();
    expect(task.archivePath).toStartWith(join(root, "archive"));
  });

  it("sends a task whose PR was closed without merging to a person", async () => {
    const id = prOpenTask(project(), { pr: { url: "https://github.com/org/repo/pull/71", number: 71 } });
    const { gh } = fakeGh({ "https://github.com/org/repo/pull/71": open({ state: "CLOSED", url: "https://github.com/org/repo/pull/71" }) });
    const result = await syncPullRequests({ gh });
    expect(result.closed).toContain(id);
    const task = getTaskById(id)!;
    expect(task.status).toBe(TaskStatus.NeedsHuman);
    expect(task.blocker).toMatchObject({ phase: "merge", fromStatus: TaskStatus.PrOpen, raisedBy: "github" });
    expect(task.blocker!.reason).toContain("closed without merging");
  });

  it("leaves the task alone when gh fails, and reports the error", async () => {
    const id = prOpenTask(project(), { pr: { url: "https://github.com/org/repo/pull/72", number: 72 } });
    const { gh } = fakeGh({ "https://github.com/org/repo/pull/72": { exitCode: 4, stdout: "", stderr: "gh: To get started, run: gh auth login\nmore" } });
    const result = await syncPullRequests({ gh });
    expect(result.errors).toContainEqual({ taskId: id, error: "gh: To get started, run: gh auth login" });
    const task = getTaskById(id)!;
    expect(task.status).toBe(TaskStatus.PrOpen);
    expect(task.pullRequest?.checkedAt).toBeNull();
  });

  it("finds a PR by the task's branch when submit_pr recorded no URL, and keeps what it saw", async () => {
    const id = prOpenTask(project(), { pr: null });
    patchTask(id, { realBranch: `feat/${id}` });
    const { gh, calls } = fakeGh({
      [`feat/${id}`]: open({
        url: `https://github.com/org/repo/pull/73`,
        number: 73,
        headRefName: `feat/${id}`,
        reviews: [{ state: "CHANGES_REQUESTED", author: { login: "bob" } }],
        statusCheckRollup: [{ conclusion: "FAILURE" }],
      }),
    });
    await syncPullRequests({ gh });
    expect(calls.some((c) => c[2] === `feat/${id}`)).toBe(true);
    const task = getTaskById(id)!;
    expect(task.status).toBe(TaskStatus.PrOpen);
    expect(task.pullRequest).toMatchObject({ url: "https://github.com/org/repo/pull/73", number: 73, changesRequestedBy: ["bob"], checks: "failure" });
    expect(task.pullRequest!.checkedAt).not.toBeNull();
  });

  describe("L3 auto-merge", () => {
    const green = (url: string, extra: object = {}) =>
      open({ url, statusCheckRollup: [{ conclusion: "SUCCESS" }], reviews: [], ...extra });
    const merges = (calls: string[][], url: string) => calls.filter((c) => c[1] === "merge" && c[2] === url);

    it("merges a green, low-risk PR nobody asked changes on, and completes the task", async () => {
      const url = "https://github.com/org/repo/pull/80";
      const id = prOpenTask(project({ autonomy: 3, policy: { autoMerge: true } }), { risk: "low", pr: { url, number: 80 } });
      const { gh, calls } = fakeGh({ [url]: green(url) });
      const result = await syncPullRequests({ gh });
      expect(merges(calls, url)).toEqual([["pr", "merge", url, "--squash"]]);
      expect(result.autoMerged).toContain(id);
      const task = getTaskById(id)!;
      expect(task.status).toBe(TaskStatus.Complete);
      expect(task.pullRequest).toMatchObject({ state: "merged", mergedBy: "agentq-auto-merge" });
      expect(getActivityEvents({ taskId: id }).map((e) => e.eventType)).toEqual(expect.arrayContaining(["pr_auto_merged", "pr_merged"]));
    });

    const cases: [string, { autonomy: AutonomyLevel; autoMerge: boolean; risk: Risk; view: object }][] = [
      ["below L3", { autonomy: 2, autoMerge: true, risk: "low", view: {} }],
      ["autoMerge off", { autonomy: 3, autoMerge: false, risk: "low", view: {} }],
      ["medium risk", { autonomy: 3, autoMerge: true, risk: "medium", view: {} }],
      ["checks pending", { autonomy: 3, autoMerge: true, risk: "low", view: { statusCheckRollup: [{ status: "IN_PROGRESS" }] } }],
      ["no checks", { autonomy: 3, autoMerge: true, risk: "low", view: { statusCheckRollup: [] } }],
      ["a person asked for changes", { autonomy: 3, autoMerge: true, risk: "low", view: { reviews: [{ state: "CHANGES_REQUESTED", author: { login: "p" } }] } }],
    ];
    cases.forEach(([name, c], i) => {
      it(`does not merge: ${name}`, async () => {
        const url = `https://github.com/org/repo/pull/${90 + i}`;
        const id = prOpenTask(project({ autonomy: c.autonomy, policy: { autoMerge: c.autoMerge } }), { risk: c.risk, pr: { url, number: 90 + i } });
        const { gh, calls } = fakeGh({ [url]: green(url, c.view) });
        await syncPullRequests({ gh });
        expect(merges(calls, url)).toEqual([]);
        expect(getTaskById(id)!.status).toBe(TaskStatus.PrOpen);
      });
    });

    it("merges once the person who asked for changes approved the PR", async () => {
      const url = "https://github.com/org/repo/pull/81";
      const id = prOpenTask(project({ autonomy: 3, policy: { autoMerge: true } }), { risk: "low", pr: { url, number: 81 } });
      const reviews = [
        { state: "CHANGES_REQUESTED", author: { login: "p" }, submittedAt: "2026-09-01T10:00:00Z" },
        { state: "APPROVED", author: { login: "p" }, submittedAt: "2026-09-01T11:00:00Z" },
      ];
      const { gh, calls } = fakeGh({ [url]: green(url, { reviews }) });
      await syncPullRequests({ gh });
      expect(merges(calls, url)).toHaveLength(1);
      expect(getTaskById(id)!.status).toBe(TaskStatus.Complete);
      expect(getTaskById(id)!.pullRequest?.changesEverRequestedBy).toEqual(["p"]);
    });

    it("keeps the task in pr_open when the merge fails", async () => {
      const url = "https://github.com/org/repo/pull/99";
      const id = prOpenTask(project({ autonomy: 3, policy: { autoMerge: true } }), { risk: "low", pr: { url, number: 99 } });
      const { gh } = fakeGh({ [url]: green(url) }, { exitCode: 1, stdout: "", stderr: "Pull request is not mergeable" });
      const result = await syncPullRequests({ gh });
      expect(result.errors).toContainEqual({ taskId: id, error: "auto-merge failed: Pull request is not mergeable" });
      expect(getTaskById(id)!.status).toBe(TaskStatus.PrOpen);
    });
  });
});

describe("gh without blocking the server", () => {
  const bun = (script: string) => [process.execPath, "-e", script];

  it("runs gh asynchronously and returns its output and exit code", async () => {
    const run = ghRunner(bun("console.log(process.argv.slice(1).join(' ')); console.error('warn'); process.exit(3)"), 10_000);
    expect(await run(["pr", "view", "7"], root)).toEqual({ exitCode: 3, stdout: "pr view 7\n", stderr: "warn\n" });
    expect((await ghRunner(["agentq-no-such-gh"])(["pr"], root)).exitCode).toBe(127);
  });

  it("kills a gh call that hangs, and the event loop keeps running meanwhile", async () => {
    let ticks = 0;
    const ticker = setInterval(() => ticks++, 20);
    const started = Date.now();
    const result = await ghRunner(bun("setTimeout(() => {}, 30000)"), 300)(["pr", "view", "1"], root);
    clearInterval(ticker);
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(ticks).toBeGreaterThan(3);
  });

  it("leaves a task a person moved while gh was running", async () => {
    const url = "https://github.com/org/repo/pull/60";
    const id = prOpenTask(project({ autonomy: 3, policy: { autoMerge: true } }), { risk: "low", pr: { url, number: 60 } });
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      if (args[2] === url) cancelTask(id, { message: "not needed" });
      return ok(open({ url, state: "MERGED" }));
    };
    const result = await syncPullRequests({ gh });
    expect(result.merged).not.toContain(id);
    expect(getTaskById(id)!.status).toBe(TaskStatus.Canceled);
    expect(calls.filter((c) => c[1] === "merge")).toEqual([]);
  });

  it("runs one pass at a time: a second runOnce joins the running one", async () => {
    const url = "https://github.com/org/repo/pull/61";
    prOpenTask(project(), { pr: { url, number: 61 } });
    let views = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gh: GhRunner = async (args) => {
      if (args[2] === url) {
        views++;
        await gate;
      }
      return ok(open({ url }));
    };
    const sync = new PrSync(() => {}, 60_000, gh);
    const first = sync.runOnce();
    const second = sync.runOnce();
    expect(second).toBe(first);
    release();
    await first;
    expect(views).toBe(1);
    await sync.runOnce();
    expect(views).toBe(2);
  });
});
