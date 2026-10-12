#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMoonlightqMcpServer } from "./server.js";

// A runner job's server starts out holding the job's claim (see claimEnv in launch.ts).
const { MOONLIGHTQ_TASK_ID: taskId, MOONLIGHTQ_CLAIM_TOKEN: claimToken } = process.env;
const claims = taskId && claimToken ? { [taskId]: claimToken } : {};

// stdout is the MCP channel: nothing else may write to it while the server runs.
const server = createMoonlightqMcpServer({ claims });
await server.connect(new StdioServerTransport());
