#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentQMcpServer } from "./server.js";

// stdout is the MCP channel: nothing else may write to it while the server runs.
const server = createAgentQMcpServer();
await server.connect(new StdioServerTransport());
