import { installMcp } from "./install-mcp.js";
import { installSkills } from "./install-skills.js";

/**
 * Registers the AgentQ MCP server and installs the workflow skills.
 *
 *   bun run install:all              # same options as install:mcp (e.g. --db <path>)
 */
const mcpOk = installMcp(process.argv.slice(2));
const skillsOk = installSkills();
if (!mcpOk || !skillsOk) process.exit(1);
