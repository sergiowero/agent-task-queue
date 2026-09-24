import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createProject,
  createTask,
  deleteTask,
  getTasks,
  getTaskById,
  getActivityEvents,
  updateTask,
  TaskStatus,
  skillsBundleVersion,
} from "@agentq/shared";
import { createAgentQMcpServer, INSTRUCTIONS, SERVER_NAME } from "./server.js";
import {
  MCP_ENTRY,
  MCP_SERVER_NAME,
  RUNNER_MCP_TOOLS,
  mcpServerLaunch,
  mcpServersConfig,
} from "./launch.js";

// Set test DB before any DB access (the path is resolved lazily in getDb()).
process.env.AGENTQ_DB_PATH = ":memory:";

const TOOL_NAMES = [
  "claim_task",
  "submit_plan",
  "submit_code",
  "submit_review",
  "submit_merge",
  "get_task",
  "list_tasks",
  "list_projects",
  "create_task",
  "post_comment",
  "archive_task",
  "report_blocker",
  "heartbeat",
  "submit_verification",
  "get_task_brief",
  "get_skill",
];

const senior = {
  toolName: "TestAgent",
  version: "1.0",
  model: "test-model",
  role: "senior",
  sessionId: "session-mcp",
};

function parse(result: CallToolResult): any {
  const first = result.content[0];
  expect(first.type).toBe("text");
  return JSON.parse((first as { type: "text"; text: string }).text);
}

/** Text of a call rejected by input validation (the SDK reports it as a plain-text error). */
function validationError(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  const first = result.content[0] as { type: "text"; text: string };
  expect(first.text).toContain("Input validation error");
  return first.text;
}

/** Other test files share the in-memory database: leave no claimable task behind. */
function removeProjectTasks(...projectIds: string[]): void {
  for (const projectId of projectIds) {
    for (const task of getTasks(projectId, { includeArchived: true })) deleteTask(task.id);
  }
}

function resourceText(content: { text?: string; blob?: string }): string {
  expect(typeof content.text).toBe("string");
  return content.text!;
}

describe("AgentQ MCP server", () => {
  const projectId = "mcp-project-" + Date.now();
  let client: Client;

  beforeAll(async () => {
    // L0 (supervised): the submits keep their classic destinations; L2 routing has its own suite.
    createProject({ id: projectId, displayName: "MCP Project", workingDirectory: "/tmp/mcp", autonomy: 0 });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createAgentQMcpServer().connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("announces itself with instructions", () => {
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
  });

  it("lists all protocol tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of TOOL_NAMES) {
      expect(names).toContain(name);
    }
    expect(tools.find((t) => t.name === "claim_task")?.inputSchema.required).toEqual(
      expect.arrayContaining(["toolName", "version", "model", "role", "sessionId"]),
    );
  });

  it("lists resource templates and static resources", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate)).toContain("agentq://task/{taskId}");
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("agentq://projects");
  });

  it("exposes every tool a runner job is allowed to use", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of RUNNER_MCP_TOOLS) {
      expect(names).toContain(name);
    }
    expect(RUNNER_MCP_TOOLS).not.toContain("claim_task");
  });

  it("list_projects returns every project", async () => {
    const result = parse(
      (await client.callTool({ name: "list_projects", arguments: {} })) as CallToolResult,
    );
    expect(result.success).toBe(true);
    expect(result.projects.map((p: any) => p.id)).toContain(projectId);
  });

  it("create_task -> claim_task (senior) -> submit_plan follows the workflow transitions", async () => {
    const created = parse(
      (await client.callTool({
        name: "create_task",
        arguments: {
          title: "MCP flow task",
          projectId,
          description: "Exercise the protocol",
          requiresPlan: true,
          priority: 100,
          guardrails: ["no force push"],
          acceptanceCriteria: ["tests pass"],
          context: "initial context",
        },
      })) as CallToolResult,
    );
    expect(created.success).toBe(true);
    expect(created.task.status).toBe(TaskStatus.PlanRequested);
    expect(created.task.project.id).toBe(projectId);
    expect(created.task.guardrails).toEqual(["no force push"]);
    expect(created.task.acceptanceCriteria).toEqual([
      { id: "AC1", text: "tests pass", verify: { kind: "review" }, status: "pending", evidenceIds: [] },
    ]);
    expect(created.task.contexts).toEqual(["initial context"]);
    const taskId: string = created.task.id;

    const claimed = parse(
      (await client.callTool({
        name: "claim_task",
        arguments: { ...senior, projectId, context: "claim context" },
      })) as CallToolResult,
    );
    expect(claimed.success).toBe(true);
    expect(claimed.task.id).toBe(taskId);
    expect(claimed.task.status).toBe(TaskStatus.Planning);
    expect(claimed.task.project.id).toBe(projectId);
    expect(claimed.agent).toEqual({ id: "testagent@1.0|test-model", role: "planner" });
    expect(claimed.task.assignedAgent).toMatchObject({
      name: "TestAgent",
      tool: "TestAgent",
      model: "test-model",
      agentId: "testagent@1.0|test-model",
      sessionKey: expect.stringMatching(/^mcp:/),
    });
    // The token comes back once, to the claimer; the task itself never shows it.
    expect(claimed.claimToken).toBe(getTaskById(taskId)!.claimToken!);
    expect(claimed.task.claimToken).toBeUndefined();
    expect(claimed.skillsVersion).toBe(skillsBundleVersion()!);
    expect(claimed.skills["agentq-claim"]).toBe(skillsBundleVersion()!);
    expect(claimed.task.contexts).toEqual(["initial context", "claim context"]);

    const planResult = (await client.callTool({
      name: "submit_plan",
      arguments: { taskId, message: "1. do it", context: "plan context" },
    })) as CallToolResult;
    expect(planResult.isError).toBeFalsy();
    const plan = parse(planResult);
    expect(plan).toEqual({
      success: true,
      taskId,
      previousStatus: TaskStatus.Planning,
      newStatus: TaskStatus.WaitingPlanReview,
      message: "Plan submitted. Task moved to Plan review.",
    });
    expect(planResult.structuredContent).toEqual(plan);

    const stored = getTaskById(taskId)!;
    expect(stored.status).toBe(TaskStatus.WaitingPlanReview);
    expect(stored.assignedAgent).toBeNull();
    expect(stored.contexts).toEqual(["initial context", "claim context", "plan context"]);
    expect(stored.history.map((h) => [h.pre_status, h.new_status])).toEqual([
      [TaskStatus.PlanRequested, TaskStatus.Planning],
      [TaskStatus.Planning, TaskStatus.WaitingPlanReview],
    ]);
    expect(stored.conversation.map((c) => [c.authorName, c.message, c.messageType])).toEqual([
      ["testagent@1.0|test-model", "Claimed task. Transitioning to planning.", "agent"],
      ["agent", "1. do it", "plan"],
    ]);
  });

  it("claim_task reports no_tasks_available without error", async () => {
    const emptyProject = "mcp-empty-" + Date.now();
    createProject({ id: emptyProject, displayName: "Empty", workingDirectory: "/tmp/empty" });
    const result = (await client.callTool({
      name: "claim_task",
      arguments: { ...senior, projectId: emptyProject },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(parse(result)).toEqual({
      success: false,
      reason: "no_tasks_available",
      message: "No tasks available for your role.",
    });
  });

  it("invalid transition returns isError with the workflow error message", async () => {
    const task = createTask({ title: "not planning", description: "d", projectId });
    const result = (await client.callTool({
      name: "submit_plan",
      arguments: { taskId: task.id, message: "plan", context: "c" },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(parse(result)).toEqual({ success: false, error: "Task must be in Planning status." });
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.ReadyForCode);

    const missing = (await client.callTool({
      name: "submit_code",
      arguments: { taskId: "does-not-exist", message: "m", worktree: "/tmp/wt", context: "c" },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
    expect(parse(missing)).toEqual({ success: false, error: "Task not found." });
  });

  it("submit_code, submit_review and submit_merge record their submissions", async () => {
    const coding = createTask({ title: "coding", description: "d", projectId });
    updateTask(coding.id, {
      status: TaskStatus.Coding,
      assignedAgent: { name: "a", tool: "a", model: "m" },
    });
    const code = parse(
      (await client.callTool({
        name: "submit_code",
        arguments: {
          taskId: coding.id,
          message: "done",
          worktree: "/tmp/wt-code",
          author: "bob",
          context: "Check the cache invalidation first",
        },
      })) as CallToolResult,
    );
    expect(code).toEqual({
      success: true,
      taskId: coding.id,
      previousStatus: TaskStatus.Coding,
      newStatus: TaskStatus.WaitingCodeReview,
      message: "Code submitted. Task moved to Code review.",
    });
    const storedCode = getTaskById(coding.id)!;
    expect(storedCode.worktreePath).toBe("/tmp/wt-code");
    expect(storedCode.assignedAgent).toBeNull();
    expect(storedCode.conversation.at(-1)).toMatchObject({ authorName: "bob", message: "done" });
    expect(storedCode.contexts).toEqual(["Check the cache invalidation first"]);

    const reviewing = createTask({ title: "reviewing", description: "d", projectId });
    updateTask(reviewing.id, { status: TaskStatus.Reviewing });
    const review = parse(
      (await client.callTool({
        name: "submit_review",
        arguments: { taskId: reviewing.id, verdict: "approve", message: "LGTM", context: "Approve, no blockers" },
      })) as CallToolResult,
    );
    expect(review).toMatchObject({
      success: true,
      previousStatus: TaskStatus.Reviewing,
      newStatus: TaskStatus.WaitingCodeReview,
      message: "Review submitted (approve). Task moved to Code review.",
    });

    const merging = createTask({ title: "merging", description: "d", projectId });
    updateTask(merging.id, { status: TaskStatus.Merging });
    const merge = parse(
      (await client.callTool({
        name: "submit_merge",
        arguments: {
          taskId: merging.id,
          mergeBranch: "develop",
          commit: "abc123",
          authors: "dev1,dev2",
          worktree: "/tmp/wt-merge",
          message: "squashed",
          context: "PR #7 open against develop",
        },
      })) as CallToolResult,
    );
    expect(merge).toEqual({
      success: true,
      taskId: merging.id,
      previousStatus: TaskStatus.Merging,
      newStatus: TaskStatus.Merged,
      message: "Merge submitted. Task moved to Merged.",
    });
    expect(getTaskById(merging.id)!.conversation.at(-1)?.message).toBe(
      "Merge submitted. Branch: develop, Commit: abc123, Authors: dev1,dev2, Worktree: /tmp/wt-merge, Message: squashed",
    );
  });

  it("get_task returns the task with its project", async () => {
    const task = createTask({ title: "get me", description: "d", projectId });
    const result = parse(
      (await client.callTool({
        name: "get_task",
        arguments: { taskId: task.id },
      })) as CallToolResult,
    );
    expect(result.success).toBe(true);
    expect(result.task.id).toBe(task.id);
    expect(result.task.project).toMatchObject({ id: projectId, displayName: "MCP Project" });

    const missing = (await client.callTool({
      name: "get_task",
      arguments: { taskId: "nope" },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
    expect(parse(missing)).toEqual({ success: false, error: "Task not found." });
  });

  it("post_comment appends an agent conversation entry and a comment_added event", async () => {
    const task = createTask({ title: "comment me", description: "d", projectId });
    const result = parse(
      (await client.callTool({
        name: "post_comment",
        arguments: { taskId: task.id, message: "halfway there", author: "worker" },
      })) as CallToolResult,
    );
    expect(result.success).toBe(true);
    expect(result.task.status).toBe(TaskStatus.ReadyForCode);
    expect(result.task.conversation).toEqual([
      expect.objectContaining({
        authorName: "worker",
        message: "halfway there",
        messageType: "agent",
      }),
    ]);
    const events = getActivityEvents({ taskId: task.id });
    expect(events.map((e) => [e.eventType, e.actor, e.details])).toEqual([
      ["comment_added", "worker", "halfway there"],
    ]);
  });

  it("archive_task writes the archive files for a complete task", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentq-mcp-archive-"));
    try {
      const archiveProject = "mcp-archive-" + Date.now();
      createProject({ id: archiveProject, displayName: "Archive", workingDirectory: root });
      const task = createTask({
        title: "Archive via MCP",
        description: "d",
        projectId: archiveProject,
      });

      const early = (await client.callTool({
        name: "archive_task",
        arguments: { taskId: task.id },
      })) as CallToolResult;
      expect(early.isError).toBe(true);
      expect(parse(early).error).toContain("Only complete tasks can be archived");

      updateTask(task.id, { status: TaskStatus.Complete });
      const result = parse(
        (await client.callTool({
          name: "archive_task",
          arguments: { taskId: task.id, overview: "- Done.", pullRequests: ["#3"] },
        })) as CallToolResult,
      );
      expect(result.success).toBe(true);
      expect(result.directory).toBe(join(root, "archive"));
      expect(result.pullRequests).toEqual(["#3"]);
      expect(readFileSync(result.summaryPath, "utf8")).toContain("## Overview\n\n- Done.");
      expect(existsSync(result.detailedPath)).toBe(true);
      const stored = getTaskById(task.id)!;
      expect(stored.archivePath).toBe(result.summaryPath);
      expect(stored.conversation.at(-1)?.authorName).toBe("agent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads agentq://task/{id} and agentq://projects resources", async () => {
    const task = createTask({ title: "resource", description: "d", projectId });
    const { contents } = await client.readResource({ uri: `agentq://task/${task.id}` });
    expect(contents).toHaveLength(1);
    expect(contents[0].mimeType).toBe("application/json");
    const json = JSON.parse(resourceText(contents[0]));
    expect(json.id).toBe(task.id);
    expect(json.project.id).toBe(projectId);

    const projects = await client.readResource({ uri: "agentq://projects" });
    const list = JSON.parse(resourceText(projects.contents[0]));
    expect(Array.isArray(list)).toBe(true);
    expect(list.map((p: any) => p.id)).toContain(projectId);

    await expect(client.readResource({ uri: "agentq://task/missing" })).rejects.toThrow(
      "Task not found.",
    );
  });
});

describe("AgentQ MCP agent workflow", () => {
  // Same scenarios agents go through: every role, every claim and submit transition.
  const projectId = "mcp-workflow-" + Date.now();
  const agent = { toolName: "Test Agent", version: "1.0.0", model: "test-model" };
  let client: Client;
  let primaryClient: Client | null = null;
  let planTaskId: string;
  let codeTaskId: string;

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }

  async function ok(name: string, args: Record<string, unknown>): Promise<any> {
    const result = await call(name, args);
    expect(result.isError).toBeFalsy();
    const out = parse(result);
    expect(result.structuredContent).toEqual(out);
    return out;
  }

  function claim(role: string, sessionId: string) {
    return ok("claim_task", { ...agent, role, sessionId, projectId });
  }

  async function status(taskId: string): Promise<string> {
    const out = await ok("get_task", { taskId });
    return out.task.status;
  }

  beforeAll(async () => {
    createProject({
      id: projectId,
      displayName: "Workflow Project",
      workingDirectory: "/tmp/workflow",
      autonomy: 0,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createAgentQMcpServer().connect(serverTransport);
    client = new Client({ name: "workflow-client", version: "0.0.0" });
    await client.connect(clientTransport);

    planTaskId = (
      await ok("create_task", {
        title: "Workflow plan task",
        projectId,
        description: "d",
        requiresPlan: true,
        priority: 100,
      })
    ).task.id;
    codeTaskId = (
      await ok("create_task", {
        title: "Workflow code task",
        projectId,
        description: "d",
        priority: 100,
      })
    ).task.id;
  });

  afterAll(async () => {
    await client.close();
    removeProjectTasks(projectId);
  });

  it("rejects a claim with missing identity fields or an invalid role", async () => {
    const missing = validationError(await call("claim_task", { role: "planner" }));
    for (const field of ["toolName", "version", "model", "sessionId"]) {
      expect(missing).toContain(field);
    }
    const wizard = validationError(
      await call("claim_task", { ...agent, role: "wizard", sessionId: "s0", projectId }),
    );
    expect(wizard).toContain("role");
  });

  it("planner claims the plan_requested task -> planning", async () => {
    const out = await claim("planner", "s1");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(planTaskId);
    expect(out.task.status).toBe(TaskStatus.Planning);
    expect(out.agent.role).toBe("planner");
    expect(typeof out.agent.id).toBe("string");
  });

  it("submit_plan moves the task to waiting_plan_review", async () => {
    const out = await ok("submit_plan", {
      taskId: planTaskId,
      message: "Here is the plan",
      context: "  Start from api.ts; keep the old endpoint  ",
    });
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(planTaskId);
    expect(await status(planTaskId)).toBe(TaskStatus.WaitingPlanReview);

    const got = await ok("get_task", { taskId: planTaskId });
    expect(got.task.contexts.at(-1)).toBe("Start from api.ts; keep the old endpoint");
  });

  it("submit_plan is rejected when the task is not in Planning", async () => {
    const res = await call("submit_plan", { taskId: planTaskId, message: "again", context: "c" });
    expect(res.isError).toBe(true);
    expect(parse(res)).toEqual({ success: false, error: "Task must be in Planning status." });
  });

  it("returns no_tasks_available when nothing is claimable for the role", async () => {
    // No task is in code_review_requested yet, so a reviewer has nothing to claim.
    const out = await claim("reviewer", "s2");
    expect(out).toMatchObject({ success: false, reason: "no_tasks_available" });
    expect(typeof out.message).toBe("string");
  });

  it("architect does not claim implementation work", async () => {
    // Only the ready_for_code task is claimable here, and architects plan and review.
    expect(await claim("architect", "s2b")).toMatchObject({
      success: false,
      reason: "no_tasks_available",
    });
  });

  it("implementer claims the ready_for_code task -> coding", async () => {
    const out = await claim("implementer", "s3");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(codeTaskId);
    expect(out.task.status).toBe(TaskStatus.Coding);
    expect(out.agent.role).toBe("implementer");
  });

  it("submit_code requires the worktree", async () => {
    const text = validationError(
      await call("submit_code", { taskId: codeTaskId, message: "x", context: "c" }),
    );
    expect(text).toContain("worktree");
    expect(await status(codeTaskId)).toBe(TaskStatus.Coding);
  });

  it("submit_code moves the task to waiting_code_review and stores the worktree", async () => {
    const out = await ok("submit_code", {
      taskId: codeTaskId,
      worktree: "/tmp/wt/code-task",
      message: "Implemented",
      context: "Review the retry loop first",
    });
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(codeTaskId);

    const got = await ok("get_task", { taskId: codeTaskId });
    expect(got.task.status).toBe(TaskStatus.WaitingCodeReview);
    expect(got.task.worktreePath).toBe("/tmp/wt/code-task");
    expect(got.task.assignedAgent).toBeNull();
    expect(got.task.contexts.at(-1)).toBe("Review the retry loop first");
  });

  it("every submit_* tool requires a non-blank context", async () => {
    const submits: [string, string, Record<string, unknown>][] = [
      ["submit_plan", planTaskId, { message: "x" }],
      ["submit_code", codeTaskId, { message: "x", worktree: "/tmp/wt" }],
      ["submit_review", codeTaskId, { verdict: "approve", message: "x" }],
      ["submit_merge", codeTaskId, { mergeBranch: "develop", commit: "abc", authors: "dev" }],
    ];
    for (const [tool, taskId, args] of submits) {
      const before = await ok("get_task", { taskId });
      for (const context of [undefined, "   "]) {
        expect(validationError(await call(tool, { taskId, ...args, context }))).toContain("context");
      }
      const after = await ok("get_task", { taskId });
      expect(after.task.status).toBe(before.task.status);
      expect(after.task.contexts).toEqual(before.task.contexts);
    }
  });

  it("senior claims a code_review_requested task as reviewer -> reviewing", async () => {
    updateTask(codeTaskId, { status: TaskStatus.CodeReviewRequested });
    // This session wrote the code, so it may not review it: another session does.
    const own = await claim("senior", "s4");
    expect(own.reason).toBe("no_tasks_available");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createAgentQMcpServer().connect(serverTransport);
    const reviewerClient = new Client({ name: "reviewer-client", version: "0.0.0" });
    await reviewerClient.connect(clientTransport);
    primaryClient = client;
    client = reviewerClient;
    const out = await claim("senior", "s4");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(codeTaskId);
    expect(out.task.status).toBe(TaskStatus.Reviewing);
    expect(out.agent.role).toBe("reviewer");
  });

  it("submit_review moves the task back to waiting_code_review (L0: the verdict is advice)", async () => {
    const out = await ok("submit_review", {
      taskId: codeTaskId,
      verdict: "approve",
      message: "Looks good",
      context: "Approve, no blockers",
    });
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(codeTaskId);
    expect(await status(codeTaskId)).toBe(TaskStatus.WaitingCodeReview);
    await client.close();
    client = primaryClient!;
  });

  it("implementer claims an approved task -> merging", async () => {
    updateTask(codeTaskId, { status: TaskStatus.Approved });
    const out = await claim("implementer", "s5");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(codeTaskId);
    expect(out.task.status).toBe(TaskStatus.Merging);
    expect(out.agent.role).toBe("implementer");
  });

  it("submit_merge requires mergeBranch, commit and authors, then moves the task to merged", async () => {
    const missing = validationError(
      await call("submit_merge", { taskId: codeTaskId, mergeBranch: "feat/x", context: "c" }),
    );
    expect(missing).toContain("commit");
    expect(missing).toContain("authors");
    expect(await status(codeTaskId)).toBe(TaskStatus.Merging);

    const out = await ok("submit_merge", {
      taskId: codeTaskId,
      mergeBranch: "feat/x",
      commit: "abc123",
      authors: "dev1,dev2",
      context: "PR #42 open against develop",
    });
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(codeTaskId);

    const got = await ok("get_task", { taskId: codeTaskId });
    expect(got.task.status).toBe(TaskStatus.Merged);
    expect(got.task.assignedAgent).toBeNull();
    const last = got.task.conversation[got.task.conversation.length - 1];
    expect(last.message).toContain("Branch: feat/x");
    expect(last.message).toContain("Commit: abc123");
    expect(last.message).toContain("Authors: dev1,dev2");
  });

  it("senior claims a plan_changes_requested task as planner -> planning", async () => {
    updateTask(planTaskId, { status: TaskStatus.PlanChangesRequested });
    const out = await claim("senior", "s6");
    expect(out.success).toBe(true);
    expect(out.task.id).toBe(planTaskId);
    expect(out.task.status).toBe(TaskStatus.Planning);
    expect(out.agent.role).toBe("planner");
  });
});

describe("AgentQ MCP create, list and archive", () => {
  const projectId = "mcp-create-" + Date.now();
  const archiveRoot = mkdtempSync(join(tmpdir(), "agentq-mcp-archive-list-"));
  const archiveProjectId = "mcp-archive-list-" + Date.now();
  let client: Client;

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }

  async function ok(name: string, args: Record<string, unknown>): Promise<any> {
    const result = await call(name, args);
    expect(result.isError).toBeFalsy();
    return parse(result);
  }

  beforeAll(async () => {
    createProject({
      id: projectId,
      displayName: "Create Project",
      workingDirectory: "/tmp/create",
    });
    createProject({
      id: archiveProjectId,
      displayName: "Archive List",
      workingDirectory: archiveRoot,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createAgentQMcpServer().connect(serverTransport);
    client = new Client({ name: "create-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    removeProjectTasks(projectId, archiveProjectId);
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it("create_task stores every option and trims list entries", async () => {
    const out = await ok("create_task", {
      title: "Plan me",
      projectId,
      description: "A task that needs a plan",
      steerDetails: "Use the existing helpers",
      acceptanceCriteria: ["a", " b ", ""],
      guardrails: ["no force push", " keep it small "],
      context: "initial context",
      requiresPlan: true,
      priority: 7,
      branch: "feat/plan-me",
      mergeBranch: "main",
    });
    expect(out.success).toBe(true);
    expect(typeof out.task.id).toBe("string");
    expect(out.task).toMatchObject({
      title: "Plan me",
      status: TaskStatus.PlanRequested,
      requiresPlan: true,
      priority: 7,
      steerDetails: "Use the existing helpers",
      recommendedBranch: "feat/plan-me",
      mergeBranch: "main",
      acceptanceCriteria: [
        { id: "AC1", text: "a", verify: { kind: "review" }, status: "pending", evidenceIds: [] },
        { id: "AC2", text: "b", verify: { kind: "review" }, status: "pending", evidenceIds: [] },
      ],
      guardrails: ["no force push", "keep it small"],
      contexts: ["initial context"],
    });
    expect(out.task.project.id).toBe(projectId);
  });

  it("create_task defaults to ready_for_code, priority 0 and the project's default branch", async () => {
    const out = await ok("create_task", { title: "Just code", projectId, description: "d" });
    expect(out.task).toMatchObject({
      status: TaskStatus.ReadyForCode,
      requiresPlan: false,
      priority: 0,
      // /tmp/create is not a git repository: the project default falls back to main.
      mergeBranch: "main",
      contexts: [],
    });
    const created = getActivityEvents({ taskId: out.task.id });
    // A one-letter description without criteria is not ready: created, with a warning.
    expect(created.map((e) => [e.eventType, e.actor]).sort()).toEqual([
      ["dor_warning", "agent"],
      ["task_created", "agent"],
    ]);
    expect(out.task.dorIssues.length).toBeGreaterThan(0);
  });

  it("create_task fails without the required projectId and description", async () => {
    const text = validationError(await call("create_task", { title: "Missing" }));
    expect(text).toContain("projectId");
    expect(text).toContain("description");
  });

  it("list_tasks returns tasks with their project, filtered by status and project", async () => {
    const all = await ok("list_tasks", {});
    expect(all.success).toBe(true);
    const planned = all.tasks.find((t: any) => t.title === "Plan me");
    expect(planned.project.id).toBe(projectId);

    const ready = await ok("list_tasks", { projectId, status: TaskStatus.ReadyForCode });
    expect(ready.tasks.map((t: any) => t.title)).toEqual(["Just code"]);

    validationError(await call("list_tasks", { status: "done-ish" }));
  });

  it("archive_task: complete tasks only, off the list afterwards, refuses a second time", async () => {
    const done = createTask({
      title: "Finished work",
      description: "All done",
      projectId: archiveProjectId,
    });
    updateTask(done.id, { status: TaskStatus.Complete });
    const pending = createTask({
      title: "Still pending",
      description: "d",
      projectId: archiveProjectId,
    });

    const complete = await ok("list_tasks", {
      status: TaskStatus.Complete,
      projectId: archiveProjectId,
    });
    expect(complete.tasks.map((t: { id: string }) => t.id)).toEqual([done.id]);

    const early = await call("archive_task", { taskId: pending.id });
    expect(early.isError).toBe(true);
    expect(parse(early).error).toContain("Only complete tasks can be archived");

    const out = await ok("archive_task", {
      taskId: done.id,
      pullRequests: ["https://github.com/org/repo/pull/5", "#6"],
      overview: "- Shipped it.",
    });
    expect(out.success).toBe(true);
    expect(out.taskId).toBe(done.id);
    expect(out.directory).toBe(join(archiveRoot, "archive"));
    expect(out.pullRequests).toEqual(["https://github.com/org/repo/pull/5", "#6"]);
    const summary = readFileSync(out.summaryPath, "utf8");
    expect(summary).toStartWith("# Finished work\n");
    expect(summary).toContain("## Overview\n\n- Shipped it.");
    expect(summary).toContain("<https://github.com/org/repo/pull/5>, #6");
    expect(readFileSync(out.detailedPath, "utf8")).toContain("# Finished work — full record");

    const listed = await ok("list_tasks", { projectId: archiveProjectId });
    expect(listed.tasks.map((t: { id: string }) => t.id)).toEqual([pending.id]);
    const got = await ok("get_task", { taskId: done.id });
    expect(got.task.archivePath).toBe(out.summaryPath);

    const again = await call("archive_task", { taskId: done.id });
    expect(again.isError).toBe(true);
    expect(parse(again).error).toContain("already archived");
  });

  it("archive_task writes to another directory when asked", async () => {
    const task = createTask({ title: "Elsewhere", description: "d", projectId: archiveProjectId });
    updateTask(task.id, { status: TaskStatus.Complete });
    const directory = join(archiveRoot, "custom-archive");
    const out = await ok("archive_task", { taskId: task.id, directory });
    expect(out.directory).toBe(directory);
    expect(existsSync(out.summaryPath)).toBe(true);
    expect(out.summaryPath.startsWith(directory)).toBe(true);
  });
});

describe("AgentQ MCP claims and blockers", () => {
  const projectId = "mcp-claims-" + Date.now();
  const agent = { toolName: "Claimer", version: "1.0", model: "m" };
  const clients: Client[] = [];

  async function connect(opts?: Parameters<typeof createAgentQMcpServer>[0]): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createAgentQMcpServer(opts).connect(serverTransport);
    const client = new Client({ name: "claims-client", version: "0.0.0" });
    await client.connect(clientTransport);
    clients.push(client);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }

  beforeAll(() => {
    createProject({ id: projectId, displayName: "Claims", workingDirectory: "/tmp/claims" });
  });

  afterAll(async () => {
    for (const client of clients) await client.close();
    removeProjectTasks(projectId);
  });

  it("only the session that claimed a task (or one holding its token) can submit it", async () => {
    const task = createTask({ title: "claimed elsewhere", description: "d", projectId, requiresPlan: true });
    const owner = await connect();
    const stranger = await connect();
    const claimed = parse(await call(owner, "claim_task", { ...agent, role: "planner", sessionId: "s1", projectId }));
    expect(claimed.task.id).toBe(task.id);

    const denied = await call(stranger, "submit_plan", { taskId: task.id, message: "mine", context: "c" });
    expect(denied.isError).toBe(true);
    expect(parse(denied).error).toContain("claimToken");

    const wrong = await call(stranger, "submit_plan", { taskId: task.id, message: "mine", context: "c", claimToken: "x" });
    expect(parse(wrong).error).toContain("claimed by another agent session");

    const withToken = await call(stranger, "submit_plan", {
      taskId: task.id,
      message: "plan",
      context: "c",
      claimToken: claimed.claimToken,
    });
    expect(withToken.isError).toBeFalsy();
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.WaitingPlanReview);
  });

  it("a server started with a claim (runner job) submits it without passing the token", async () => {
    const task = createTask({ title: "runner claim", description: "d", projectId, requiresPlan: true });
    const claimer = await connect();
    const claimed = parse(await call(claimer, "claim_task", { ...agent, role: "planner", sessionId: "s2", projectId }));
    expect(claimed.task.id).toBe(task.id);
    const job = await connect({ claims: { [task.id]: claimed.claimToken } });
    const out = await call(job, "submit_plan", { taskId: task.id, message: "plan", context: "c" });
    expect(out.isError).toBeFalsy();
  });

  it("report_blocker moves the task to needs_human and releases it", async () => {
    const task = createTask({ title: "cannot push", description: "d", projectId });
    const client = await connect();
    parse(await call(client, "claim_task", { ...agent, role: "implementer", sessionId: "s3", projectId }));
    const out = parse(
      await call(client, "report_blocker", {
        taskId: task.id,
        reason: "tests need a database I cannot start",
        question: "Should I mock it?",
      }),
    );
    expect(out).toMatchObject({ success: true, previousStatus: TaskStatus.Coding, newStatus: TaskStatus.NeedsHuman });
    const stored = getTaskById(task.id)!;
    expect(stored.assignedAgent).toBeNull();
    expect(stored.blocker).toMatchObject({ question: "Should I mock it?", phase: "code", fromStatus: TaskStatus.Coding });
    expect(getActivityEvents({ taskId: task.id }).some((e) => e.eventType === "task_blocked")).toBe(true);

    // Nothing claims a task that waits for a person.
    const none = parse(await call(client, "claim_task", { ...agent, role: "senior", sessionId: "s3", projectId }));
    expect(none.reason).toBe("no_tasks_available");
  });

  it("L2: submit_review needs a verdict; findings come back on get_task; the verdict routes", async () => {
    const task = createTask({ title: "l2 review", description: "d", projectId });
    const coder = await connect();
    const reviewer = await connect();
    parse(await call(coder, "claim_task", { ...agent, role: "implementer", sessionId: "c1", projectId }));
    const coded = parse(await call(coder, "submit_code", { taskId: task.id, message: "c", worktree: "/w", context: "c" }));
    expect(coded.newStatus).toBe(TaskStatus.CodeReviewRequested);

    const claimed = parse(await call(reviewer, "claim_task", { ...agent, role: "reviewer", sessionId: "r1", projectId }));
    expect(claimed.task.id).toBe(task.id);
    expect(claimed).toMatchObject({ autonomy: 2, round: { codeRound: 0, maxReviewRounds: 3 } });

    expect(validationError(await call(reviewer, "submit_review", { taskId: task.id, message: "m", context: "c" }))).toContain("verdict");
    const out = parse(
      await call(reviewer, "submit_review", {
        taskId: task.id,
        verdict: "request_changes",
        findings: [{ severity: "major", file: "src/a.ts", line: 12, text: "Missing test for the empty case" }],
        message: "One blocker",
        context: "Fix R1-1 first",
      }),
    );
    expect(out.newStatus).toBe(TaskStatus.ChangesRequested);
    const got = parse(await call(coder, "get_task", { taskId: task.id }));
    expect(got.task.findings).toMatchObject([{ id: "R1-1", severity: "major", file: "src/a.ts", line: 12, status: "open" }]);
    expect(got.task.lastReview).toMatchObject({ verdict: "request_changes", round: 1 });
  });

  it("heartbeat extends a hand-opened session's lease", async () => {
    createTask({ title: "long work", description: "d", projectId });
    const client = await connect();
    const { task } = parse(await call(client, "claim_task", { ...agent, role: "implementer", sessionId: "h1", projectId }));
    const before = getTaskById(task.id)!.leaseExpiresAt!;
    await Bun.sleep(5);
    const beat = parse(await call(client, "heartbeat", { taskId: task.id }));
    expect(beat).toMatchObject({ success: true, extended: true });
    expect(beat.leaseExpiresAt > before).toBe(true);
    const stranger = await connect();
    expect(parse(await call(stranger, "heartbeat", { taskId: task.id })).extended).toBe(false);
  });

  it("create_task takes criteria objects; submit_plan a validation plan; submit_code evidence", async () => {
    const created = parse(
      await call(await connect(), "create_task", {
        title: "evidence",
        projectId,
        description: "d",
        requiresPlan: true,
        priority: 50,
        type: "bug",
        acceptanceCriteria: ["old style", { text: "new style", verify: { kind: "command", command: "bun test x" } }],
      }),
    );
    expect(created.task.type).toBe("bug");
    expect(created.task.acceptanceCriteria.map((c: any) => [c.id, c.verify.kind])).toEqual([
      ["AC1", "review"],
      ["AC2", "command"],
    ]);
    const agentClient = await connect();
    const claimed = parse(await call(agentClient, "claim_task", { ...agent, role: "planner", sessionId: "p9", projectId }));
    expect(claimed.task.id).toBe(created.task.id);
    const bad = parse(
      await call(agentClient, "submit_plan", {
        taskId: created.task.id,
        message: "p",
        context: "c",
        validationPlan: { items: [{ criterionId: "AC3", how: "?" }], regressionCommands: [] },
      }),
    );
    expect(bad.error).toContain("unknown criteria: AC3");
    parse(
      await call(agentClient, "submit_plan", {
        taskId: created.task.id,
        message: "p",
        context: "c",
        validationPlan: { items: [{ criterionId: "AC2", how: "test", command: "bun test x" }], regressionCommands: ["bun test"] },
      }),
    );
    expect(getTaskById(created.task.id)!.validationPlan?.regressionCommands).toEqual(["bun test"]);
  });

  it("submit_verification is exposed for verifier agents", async () => {
    const { tools } = await (await connect()).listTools();
    const tool = tools.find((t) => t.name === "submit_verification")!;
    expect(tool.inputSchema.required).toEqual(expect.arrayContaining(["taskId", "passed", "evidence"]));
    expect(RUNNER_MCP_TOOLS).toContain("submit_verification");
  });

  it("claim_task returns the brief instead of the conversation; get_task_brief re-reads it", async () => {
    const created = createTask({ title: "brief me", description: "d", projectId, priority: 90, acceptanceCriteria: ["x $ bun test x"] });
    const client = await connect();
    const claimed = parse(await call(client, "claim_task", { ...agent, role: "implementer", sessionId: "b1", projectId }));
    expect(claimed.task.id).toBe(created.id);
    expect(claimed.task.conversation).toBeUndefined();
    expect(claimed.task.history).toBeUndefined();
    expect(claimed.brief.criteria[0]).toMatchObject({ id: "AC1" });
    expect(claimed.phaseSkill).toMatchObject({ name: "agentq-code" });
    const again = parse(await call(client, "get_task_brief", { taskId: created.id }));
    expect(again.brief.task.id).toBe(created.id);
    const submitted = parse(
      await call(client, "submit_code", {
        taskId: created.id,
        message: "c",
        worktree: "/w",
        context: "look at x",
        decisions: ["kept it small"],
        next: ["check x"],
      }),
    );
    expect(submitted.success).toBe(true);
    const full = parse(await call(client, "get_task", { taskId: created.id }));
    expect(full.task.handoffs.at(-1)).toMatchObject({ phase: "code", summary: "look at x", decisions: ["kept it small"], next: ["check x"] });
  });

  it("serves the skills: get_skill, agentq://skills/{name} and prompts, with versions", async () => {
    const client = await connect();
    const skill = parse(await call(client, "get_skill", { name: "agentq-review" }));
    expect(skill).toMatchObject({ success: true, name: "agentq-review", version: skillsBundleVersion() });
    expect(skill.body).toContain("Severity Rubric");
    expect(parse(await call(client, "get_skill", { name: "nope" })).error).toContain("Unknown skill");
    const resource = await client.readResource({ uri: "agentq://skills/agentq-claim" });
    expect(resourceText(resource.contents[0])).toContain("claim_task");
    const { prompts } = await client.listPrompts();
    const claim = prompts.find((p) => p.name === "agentq-claim")!;
    expect(claim.description).toContain(`v${skillsBundleVersion()}`);
    const got = await client.getPrompt({ name: "agentq-plan" });
    expect((got.messages[0].content as { text: string }).text).toContain("validationPlan");
  });

  it("refuses agents whose skills are older than the server supports", async () => {
    const client = await connect();
    const out = parse(
      await call(client, "claim_task", { ...agent, role: "planner", sessionId: "s4", projectId, skillsVersion: "2.0.0" }),
    );
    expect(out).toMatchObject({ success: false, reason: "skills_outdated" });
    expect(out.message).toContain("bun run install:skills");
  });
});

describe("mcpServerLaunch", () => {
  it("starts the stdio entry with bun, bound to the given database", () => {
    const launch = mcpServerLaunch("/data/agentq.db", "/usr/local/bin/bun");
    expect(launch).toEqual({
      command: "/usr/local/bin/bun",
      args: ["run", MCP_ENTRY],
      env: { AGENTQ_DB_PATH: "/data/agentq.db" },
    });
    expect(existsSync(MCP_ENTRY)).toBe(true);
    expect(mcpServersConfig(launch)).toEqual({ mcpServers: { [MCP_SERVER_NAME]: launch } });
    expect(mcpServerLaunch("/x.db").command).toBe(process.execPath);
  });
});

describe("AgentQ MCP server over stdio", () => {
  const dbPath = join(
    tmpdir(),
    `agentq-mcp-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(dbPath + suffix);
      } catch {}
    }
  });

  it("initializes and lists tools from the launch spec alone", async () => {
    // Like a real MCP client: only the SDK's default environment plus the spec's env.
    const launch = mcpServerLaunch(dbPath);
    const transport = new StdioClientTransport({ ...launch, stderr: "pipe" });
    const client = new Client({ name: "stdio-test", version: "0.0.0" });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
      const projects = parse(
        (await client.callTool({ name: "list_projects", arguments: {} })) as CallToolResult,
      );
      expect(projects).toEqual({ success: true, projects: [] });
    } finally {
      await client.close();
    }
  });

  it("writes nothing but JSON-RPC messages on stdout", async () => {
    const launch = mcpServerLaunch(dbPath);
    const proc = Bun.spawn([launch.command, ...launch.args], {
      env: { ...process.env, ...launch.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const send = (message: object) => proc.stdin.write(JSON.stringify(message) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_task", arguments: { taskId: "nope" } },
    });
    await proc.stdin.flush();

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (!out.includes('"id":2')) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    proc.stdin.end();
    proc.kill();
    await proc.exited;

    const lines = out.split("\n").filter((line) => line.trim() !== "");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(JSON.parse(line).jsonrpc).toBe("2.0");
    }
  });
});
