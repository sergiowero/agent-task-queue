import { resolve } from "path";

/** Name the AgentQ MCP server is registered under in every coding tool. */
export const MCP_SERVER_NAME = "agentq";

/** Absolute path of the stdio entry point. */
export const MCP_ENTRY = resolve(import.meta.dir, "index.ts");

/**
 * Tools a runner job needs. The runner has already claimed the task, so the job
 * only reads it, comments and submits; claiming, creating and archiving stay out.
 */
export const RUNNER_MCP_TOOLS = [
  "get_task",
  "post_comment",
  "submit_plan",
  "submit_code",
  "submit_review",
  "submit_merge",
  "report_blocker",
  "submit_verification",
] as const;

/** How to start the server over stdio: `command args...` with `env` set. */
export interface McpServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Launch spec for the AgentQ MCP server bound to the database at `dbPath`.
 * MCP clients start servers with a minimal environment, so the database path
 * travels in `env` instead of being inherited.
 */
export function mcpServerLaunch(
  dbPath: string,
  bunPath: string = process.execPath,
  extraEnv: Record<string, string> = {},
): McpServerLaunch {
  return { command: bunPath, args: ["run", MCP_ENTRY], env: { AGENTQ_DB_PATH: dbPath, ...extraEnv } };
}

/**
 * Env that hands a runner job's MCP server the job's claim, so the agent's
 * submits for that task carry the claim token without the model passing it.
 */
export function claimEnv(taskId: string, claimToken: string, agentId?: string): Record<string, string> {
  return {
    AGENTQ_TASK_ID: taskId,
    AGENTQ_CLAIM_TOKEN: claimToken,
    ...(agentId ? { AGENTQ_AGENT_ID: agentId } : {}),
  };
}

/**
 * The common `{ "mcpServers": { "agentq": { command, args, env } } }` document,
 * read by Claude Code (`--mcp-config`), Gemini CLI settings and most MCP clients.
 */
export function mcpServersConfig(launch: McpServerLaunch): {
  mcpServers: Record<string, McpServerLaunch>;
} {
  return { mcpServers: { [MCP_SERVER_NAME]: launch } };
}
