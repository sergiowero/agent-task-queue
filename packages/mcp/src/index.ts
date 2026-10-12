#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMtqMcpServer } from "./server.js";

// A runner job's server starts out holding the job's claim (see claimEnv in launch.ts).
const { MTQ_TASK_ID: taskId, MTQ_CLAIM_TOKEN: claimToken } = process.env;
const claims = taskId && claimToken ? { [taskId]: claimToken } : {};

// stdout is the MCP channel: nothing else may write to it while the server runs.
const server = createMtqMcpServer({ claims });
await server.connect(new StdioServerTransport());
