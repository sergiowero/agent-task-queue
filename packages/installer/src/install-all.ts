import { installMcp } from "./install-mcp.js";
import { removeSkills } from "./remove-skills.js";

/**
 * Registers the MoonlightQ MCP server and removes the skill copies earlier releases
 * installed (the server ships the skills now).
 *
 *   bun run install:all              # same options as install:mcp (e.g. --db <path>)
 */
const mcpOk = installMcp(process.argv.slice(2));
removeSkills();
if (!mcpOk) process.exit(1);
