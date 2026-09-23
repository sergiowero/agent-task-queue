import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

// The CLI is exercised as a real subprocess against its own temp-file database.
// Nothing in this file touches the DB singleton of the test process.
const CLI = resolve(import.meta.dir, "index.ts");
const SHARED = resolve(import.meta.dir, "../../shared/src/index.ts");
const DB_PATH = join(tmpdir(), `agentq-cli-test-${randomUUID()}.db`);
const ENV = { ...process.env, AGENTQ_DB_PATH: DB_PATH };

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Parsed JSON from stdout (or stderr for error envelopes), if any. */
  json: any;
}

function tryParse(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

async function collect(proc: ReturnType<typeof Bun.spawn>): Promise<CliResult> {
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr, json: tryParse(stdout) ?? tryParse(stderr) };
}

function cli(...args: string[]): Promise<CliResult> {
  return collect(
    Bun.spawn(["bun", "run", CLI, ...args], { env: ENV, stdout: "pipe", stderr: "pipe" }),
  );
}

/** Runs a snippet against the shared package in a subprocess bound to the temp DB. */
function withShared(script: string): Promise<CliResult> {
  const code = `const shared = await import(${JSON.stringify(SHARED)});\n${script}`;
  return collect(Bun.spawn(["bun", "-e", code], { env: ENV, stdout: "pipe", stderr: "pipe" }));
}

async function cliOk(...args: string[]): Promise<any> {
  const res = await cli(...args);
  expect(res.stderr).toBe("");
  expect(res.code).toBe(0);
  expect(res.json).toBeDefined();
  return res.json;
}

async function getStatus(taskId: string): Promise<string> {
  const out = await cliOk("get", taskId, "--json");
  expect(out.success).toBe(true);
  expect(out.task.id).toBe(taskId);
  return out.task.status;
}

async function setStatus(taskId: string, status: string): Promise<void> {
  const res = await withShared(
    `const t = shared.updateTask(${JSON.stringify(taskId)}, { status: ${JSON.stringify(status)} });
     if (!t) { console.error("task not found"); process.exit(1); }
     console.log(JSON.stringify({ ok: true }));`,
  );
  expect(res.stderr).toBe("");
  expect(res.code).toBe(0);
}

const CLAIM_AGENT = ["-n", "Test Agent", "-v", "1.0.0", "-m", "test-model"];

const projectId = randomUUID();

beforeAll(async () => {
  // No CLI command creates projects, so seed one through the shared package.
  const res = await withShared(
    `shared.createProject({
       id: ${JSON.stringify(projectId)},
       displayName: "CLI Test Project",
       workingDirectory: "/tmp/cli-test-project",
     });
     console.log(JSON.stringify({ ok: true }));`,
  );
  expect(res.stderr).toBe("");
  expect(res.code).toBe(0);
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal", "-journal"]) {
    const p = DB_PATH + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
});

describe("agentq projects", () => {
  it("lists projects as JSON", async () => {
    const out = await cliOk("projects", "--json");
    expect(out.success).toBe(true);
    expect(Array.isArray(out.projects)).toBe(true);
    const project = out.projects.find((p: any) => p.id === projectId);
    expect(project).toBeDefined();
    expect(project.displayName).toBe("CLI Test Project");
  });
});

describe("agentq create / list / get", () => {
  let planTaskId: string;

  it("creates a task with plan, criteria, guardrails and context", async () => {
    const out = await cliOk(
      "create",
      "Plan me",
      "--project",
      projectId,
      "-d",
      "A task that needs a plan",
      "--acceptance-criteria",
      "a|b",
      "--guardrails",
      "no force push| keep it small ",
      "--context",
      "initial context",
      "--requires-plan",
      "-p",
      "7",
      "--json",
    );
    expect(out.success).toBe(true);
    expect(typeof out.task.id).toBe("string");
    expect(out.task.title).toBe("Plan me");
    expect(out.task.status).toBe("plan_requested");
    expect(out.task.requiresPlan).toBe(true);
    expect(out.task.priority).toBe(7);
    expect(out.task.acceptanceCriteria).toEqual(["a", "b"]);
    expect(out.task.guardrails).toEqual(["no force push", "keep it small"]);
    expect(out.task.contexts).toEqual(["initial context"]);
    expect(out.task.project.id).toBe(projectId);
    planTaskId = out.task.id;
  });

  it("creates a ready_for_code task when --requires-plan is omitted", async () => {
    const out = await cliOk("create", "Just code", "--project", projectId, "-d", "d", "--json");
    expect(out.success).toBe(true);
    expect(out.task.status).toBe("ready_for_code");
    expect(out.task.requiresPlan).toBe(false);
    expect(out.task.mergeBranch).toBe("develop");
  });

  it("fails without the required --project / -d options", async () => {
    const res = await cli("create", "Missing", "--json");
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("required option");
  });

  it("lists tasks with their project", async () => {
    const out = await cliOk("list", "--json");
    expect(out.success).toBe(true);
    expect(Array.isArray(out.tasks)).toBe(true);
    const task = out.tasks.find((t: any) => t.id === planTaskId);
    expect(task).toBeDefined();
    expect(task.project.id).toBe(projectId);
  });

  it("gets a task by id and errors for unknown ids", async () => {
    const out = await cliOk("get", planTaskId, "--json");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(planTaskId);
    expect(out.task.status).toBe("plan_requested");

    const missing = await cli("get", randomUUID(), "--json");
    expect(missing.code).toBe(1);
    expect(missing.json).toEqual({ success: false, error: "Task not found." });
  });
});

describe("agentq claim + submit workflow", () => {
  let planTaskId: string;
  let codeTaskId: string;

  beforeAll(async () => {
    // Fresh project so claims are deterministic (nothing else is claimable there).
    // Tasks from the previous describe still exist, so make these higher priority.
    const plan = await cliOk(
      "create",
      "Workflow plan task",
      "--project",
      projectId,
      "-d",
      "d",
      "--requires-plan",
      "-p",
      "100",
      "--json",
    );
    planTaskId = plan.task.id;
    const code = await cliOk(
      "create",
      "Workflow code task",
      "--project",
      projectId,
      "-d",
      "d",
      "-p",
      "100",
      "--json",
    );
    codeTaskId = code.task.id;
  });

  it("rejects a claim with a missing required option", async () => {
    const res = await cli("claim", "-r", "planner", "--json");
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("required option");
  });

  it("rejects an invalid role", async () => {
    const res = await cli("claim", ...CLAIM_AGENT, "-r", "wizard", "-s", "s0", "--json");
    expect(res.code).toBe(1);
    expect(res.json.success).toBe(false);
    expect(res.json.error).toContain("Invalid role");
  });

  it("planner claims the plan_requested task -> planning", async () => {
    const out = await cliOk("claim", ...CLAIM_AGENT, "-r", "planner", "-s", "s1", "--json");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(planTaskId);
    expect(out.task.status).toBe("planning");
    expect(out.agent.role).toBe("planner");
    expect(typeof out.agent.id).toBe("string");
  });

  it("submit-plan moves the task to waiting_plan_review", async () => {
    const out = await cliOk("submit-plan", planTaskId, "-m", "Here is the plan", "--json");
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(planTaskId);
    expect(await getStatus(planTaskId)).toBe("waiting_plan_review");
  });

  it("submit-plan is rejected when the task is not in Planning", async () => {
    const res = await cli("submit-plan", planTaskId, "-m", "again", "--json");
    expect(res.code).toBe(1);
    expect(res.json.success).toBe(false);
    expect(res.json.error).toContain("Planning");
  });

  it("returns no_tasks_available when nothing is claimable for the role", async () => {
    // No task is in code_review_requested yet, so a reviewer has nothing to claim.
    const out = await cliOk("claim", ...CLAIM_AGENT, "-r", "reviewer", "-s", "s2", "--json");
    expect(out).toMatchObject({ success: false, reason: "no_tasks_available" });
    expect(typeof out.message).toBe("string");
  });

  it("implementer claims the ready_for_code task -> coding", async () => {
    const out = await cliOk("claim", ...CLAIM_AGENT, "-r", "implementer", "-s", "s3", "--json");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(codeTaskId);
    expect(out.task.status).toBe("coding");
    expect(out.agent.role).toBe("implementer");
  });

  it("submit-code --worktree moves the task to waiting_code_review and stores the path", async () => {
    const out = await cliOk(
      "submit-code",
      codeTaskId,
      "--worktree",
      "/tmp/wt/code-task",
      "-m",
      "Implemented",
      "--json",
    );
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(codeTaskId);

    const got = await cliOk("get", codeTaskId, "--json");
    expect(got.task.status).toBe("waiting_code_review");
    expect(got.task.worktreePath).toBe("/tmp/wt/code-task");
    expect(got.task.assignedAgent).toBeNull();
  });

  it("submit-code requires --worktree", async () => {
    const res = await cli("submit-code", codeTaskId, "-m", "x", "--json");
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("required option");
  });

  it("senior claims a code_review_requested task as reviewer -> reviewing", async () => {
    await setStatus(codeTaskId, "code_review_requested");
    const out = await cliOk("claim", ...CLAIM_AGENT, "-r", "senior", "-s", "s4", "--json");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(codeTaskId);
    expect(out.task.status).toBe("reviewing");
    expect(out.agent.role).toBe("reviewer");
  });

  it("submit-review moves the task back to waiting_code_review", async () => {
    const out = await cliOk("submit-review", codeTaskId, "-m", "Looks good", "--json");
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(codeTaskId);
    expect(await getStatus(codeTaskId)).toBe("waiting_code_review");
  });

  it("implementer claims an approved task -> merging", async () => {
    await setStatus(codeTaskId, "approved");
    const out = await cliOk("claim", ...CLAIM_AGENT, "-r", "implementer", "-s", "s5", "--json");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(codeTaskId);
    expect(out.task.status).toBe("merging");
    expect(out.agent.role).toBe("implementer");
  });

  it("submit-merge -b -c --authors moves the task to merged", async () => {
    const missing = await cli("submit-merge", codeTaskId, "-b", "feat/x", "--json");
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain("required option");

    const out = await cliOk(
      "submit-merge",
      codeTaskId,
      "-b",
      "feat/x",
      "-c",
      "abc123",
      "--authors",
      "dev1,dev2",
      "--json",
    );
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(codeTaskId);

    const got = await cliOk("get", codeTaskId, "--json");
    expect(got.task.status).toBe("merged");
    expect(got.task.assignedAgent).toBeNull();
    const last = got.task.conversation[got.task.conversation.length - 1];
    expect(last.message).toContain("Branch: feat/x");
    expect(last.message).toContain("Commit: abc123");
    expect(last.message).toContain("Authors: dev1,dev2");
  });

  it("senior claims a plan_changes_requested task as planner -> planning", async () => {
    await setStatus(planTaskId, "plan_changes_requested");
    const out = await cliOk("claim", ...CLAIM_AGENT, "-r", "senior", "-s", "s6", "--json");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(planTaskId);
    expect(out.task.status).toBe("planning");
    expect(out.agent.role).toBe("planner");
  });
});

describe("agentq archive", () => {
  const archiveRoot = mkdtempSync(join(tmpdir(), "agentq-cli-archive-"));
  const archiveProjectId = randomUUID();
  let completeTaskId: string;
  let pendingTaskId: string;

  beforeAll(async () => {
    const res = await withShared(
      `shared.createProject({
         id: ${JSON.stringify(archiveProjectId)},
         displayName: "CLI Archive Project",
         workingDirectory: ${JSON.stringify(archiveRoot)},
       });
       console.log(JSON.stringify({ ok: true }));`,
    );
    expect(res.stderr).toBe("");
    expect(res.code).toBe(0);

    const done = await cliOk(
      "create",
      "Finished work",
      "--project",
      archiveProjectId,
      "-d",
      "All done",
      "--json",
    );
    completeTaskId = done.task.id;
    await setStatus(completeTaskId, "complete");
    const pending = await cliOk(
      "create",
      "Still pending",
      "--project",
      archiveProjectId,
      "-d",
      "d",
      "--json",
    );
    pendingTaskId = pending.task.id;
  });

  afterAll(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it("list --status / --project filter the tasks", async () => {
    const out = await cliOk(
      "list",
      "--status",
      "complete",
      "--project",
      archiveProjectId,
      "--json",
    );
    expect(out.tasks.map((t: { id: string }) => t.id)).toEqual([completeTaskId]);
  });

  it("refuses a task that is not complete", async () => {
    const res = await cli("archive", pendingTaskId, "--json");
    expect(res.code).toBe(1);
    expect(res.json.success).toBe(false);
    expect(res.json.error).toContain("Only complete tasks can be archived");
  });

  it("writes the summary and detailed files and takes the task off the list", async () => {
    const out = await cliOk(
      "archive",
      completeTaskId,
      "--pr",
      "https://github.com/org/repo/pull/5",
      "--pr",
      "#6",
      "--summary",
      "- Shipped it.",
      "--json",
    );
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(completeTaskId);
    expect(out.directory).toBe(join(archiveRoot, "archive"));
    expect(out.pullRequests).toEqual(["https://github.com/org/repo/pull/5", "#6"]);
    const summary = readFileSync(out.summaryPath, "utf8");
    expect(summary).toStartWith("# Finished work\n");
    expect(summary).toContain("## Overview\n\n- Shipped it.");
    expect(summary).toContain("<https://github.com/org/repo/pull/5>, #6");
    expect(readFileSync(out.detailedPath, "utf8")).toContain("# Finished work — full record");

    const listed = await cliOk("list", "--project", archiveProjectId, "--json");
    expect(listed.tasks.map((t: { id: string }) => t.id)).toEqual([pendingTaskId]);
    const got = await cliOk("get", completeTaskId, "--json");
    expect(got.task.archivePath).toBe(out.summaryPath);
    expect(got.task.conversation.at(-1).authorName).toBe("agent");

    const again = await cli("archive", completeTaskId, "--json");
    expect(again.code).toBe(1);
    expect(again.json.error).toContain("already archived");
  });
});
