import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createProject,
  createTask,
  getTaskById,
  getActivityEvents,
  updateTask,
  TaskStatus,
} from "@agentq/shared";
import { createAgentQMcpServer, INSTRUCTIONS, SERVER_NAME } from "./server.js";

// Set test DB before any DB access (the path is resolved lazily in getDb()).
process.env.AGENTQ_DB_PATH = ":memory:";

const MCP_ENTRY = join(import.meta.dir, "index.ts");

const TOOL_NAMES = [
  "claim_task",
  "submit_plan",
  "submit_code",
  "submit_review",
  "submit_merge",
  "get_task",
  "list_projects",
  "create_task",
  "post_comment",
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

function resourceText(content: { text?: string; blob?: string }): string {
  expect(typeof content.text).toBe("string");
  return content.text!;
}

describe("AgentQ MCP server", () => {
  const projectId = "mcp-project-" + Date.now();
  let client: Client;

  beforeAll(async () => {
    createProject({ id: projectId, displayName: "MCP Project", workingDirectory: "/tmp/mcp" });

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

  it("list_projects matches `agentq projects --json`", async () => {
    const result = parse(
      (await client.callTool({ name: "list_projects", arguments: {} })) as CallToolResult,
    );
    expect(result.success).toBe(true);
    expect(result.projects.map((p: any) => p.id)).toContain(projectId);
  });

  it("create_task -> claim_task (senior) -> submit_plan follows the CLI transitions", async () => {
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
    expect(created.task.acceptanceCriteria).toEqual(["tests pass"]);
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
    expect(claimed.task.assignedAgent).toEqual({
      name: "TestAgent",
      tool: "TestAgent",
      model: "test-model",
    });
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
      message: "Plan submitted. Task moved to Waiting Plan Review.",
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

  it("invalid transition returns isError with the CLI error message", async () => {
    const task = createTask({ title: "not planning", description: "d", projectId });
    const result = (await client.callTool({
      name: "submit_plan",
      arguments: { taskId: task.id, message: "plan" },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(parse(result)).toEqual({ success: false, error: "Task must be in Planning status." });
    expect(getTaskById(task.id)!.status).toBe(TaskStatus.ReadyForCode);

    const missing = (await client.callTool({
      name: "submit_code",
      arguments: { taskId: "does-not-exist", message: "m", worktree: "/tmp/wt" },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
    expect(parse(missing)).toEqual({ success: false, error: "Task not found." });
  });

  it("submit_code, submit_review and submit_merge mirror the CLI", async () => {
    const coding = createTask({ title: "coding", description: "d", projectId });
    updateTask(coding.id, {
      status: TaskStatus.Coding,
      assignedAgent: { name: "a", tool: "a", model: "m" },
    });
    const code = parse(
      (await client.callTool({
        name: "submit_code",
        arguments: { taskId: coding.id, message: "done", worktree: "/tmp/wt-code", author: "bob" },
      })) as CallToolResult,
    );
    expect(code).toEqual({
      success: true,
      taskId: coding.id,
      previousStatus: TaskStatus.Coding,
      newStatus: TaskStatus.WaitingCodeReview,
      message: "Code submitted. Task moved to Waiting Code Review.",
    });
    const storedCode = getTaskById(coding.id)!;
    expect(storedCode.worktreePath).toBe("/tmp/wt-code");
    expect(storedCode.assignedAgent).toBeNull();
    expect(storedCode.conversation.at(-1)).toMatchObject({ authorName: "bob", message: "done" });

    const reviewing = createTask({ title: "reviewing", description: "d", projectId });
    updateTask(reviewing.id, { status: TaskStatus.Reviewing });
    const review = parse(
      (await client.callTool({
        name: "submit_review",
        arguments: { taskId: reviewing.id, message: "LGTM" },
      })) as CallToolResult,
    );
    expect(review).toMatchObject({
      success: true,
      previousStatus: TaskStatus.Reviewing,
      newStatus: TaskStatus.WaitingCodeReview,
      message: "Review submitted. Task moved to Waiting Code Review.",
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

  it("initializes and lists tools through the bin entry point", async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", MCP_ENTRY],
      env: { ...env, AGENTQ_DB_PATH: dbPath },
      stderr: "pipe",
    });
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
});
