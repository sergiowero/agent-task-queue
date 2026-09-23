#!/usr/bin/env bun
/**
 * Stand-in for a coding tool in runner tests. It starts the AgentQ MCP server
 * described by $AGENTQ_MCP_CONFIG (or --config <file>), calls one tool and exits
 * 0 when the tool succeeded:
 *
 *   bun fake-agent.ts <tool> [json-arguments] [--config <file>] [--sleep <ms>]
 *
 * `taskId` defaults to $AGENTQ_TASK_ID. Extra arguments (the runner appends the
 * prompt) are ignored.
 */
import { readFileSync } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const [tool, rawArgs] = process.argv.slice(2);
const configPath = flag("--config") ?? process.env.AGENTQ_MCP_CONFIG;
if (!tool || !configPath) {
  console.error("usage: fake-agent <tool> [json-arguments] [--config <file>] [--sleep <ms>]");
  process.exit(2);
}

const sleepMs = Number(flag("--sleep") ?? 0);
if (sleepMs > 0) await Bun.sleep(sleepMs);

const server = JSON.parse(readFileSync(configPath, "utf8")).mcpServers.agentq;
const client = new Client({ name: "fake-agent", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: server.env,
    stderr: "inherit",
  }),
);

const args = {
  taskId: process.env.AGENTQ_TASK_ID,
  ...(rawArgs?.startsWith("{") ? JSON.parse(rawArgs) : {}),
};
const result = await client.callTool({ name: tool, arguments: args });
console.log(`prompt file: ${process.env.AGENTQ_PROMPT_FILE}`);
console.log(`${tool}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
await client.close();
process.exit(result.isError ? 1 : 0);
