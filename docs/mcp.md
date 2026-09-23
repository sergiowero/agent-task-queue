# AgentQ MCP Server

`packages/mcp` exposes the AgentQ agent protocol as an [MCP](https://modelcontextprotocol.io) server over stdio. It is the only way agents talk to AgentQ: humans use the web portal, agents use these tools. The server opens the SQLite database (`AGENTQ_DB_PATH`, default `~/.agentq/agentq.db`; its folder is created when missing) and calls the shared workflow functions in `@agentq/shared`, the same ones the web server uses. No web server needs to be running.

Run it directly from the repo:

```bash
bun run mcp          # same as: bun run packages/mcp/src/index.ts
```

The server prints nothing on stdout except the protocol; diagnostics go to stderr.

## Setup

One command registers the server with every coding tool installed on the machine (Claude Code, Codex, OpenCode, Gemini CLI, GitHub Copilot CLI, GitHub Copilot in VS Code), on macOS, Linux and Windows:

```bash
bun run install:mcp                 # database from AGENTQ_DB_PATH, default ~/.agentq/agentq.db
bun run install:mcp --db <path>     # another database
```

It adds (or updates) a user-level `agentq` server entry that starts `bun run <checkout>/packages/mcp/src/index.ts` with `AGENTQ_DB_PATH` set to the database's absolute path (`~` is expanded, `~\` too on Windows, and a relative path is resolved against the current folder). Everything else in each config file is kept, and an entry that is already up to date is not rewritten, so it is safe to run again (for example after moving the checkout or changing the database). Restart the coding tools afterwards.

| Tool                     | File it edits                                                                                                                                         | Entry                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Claude Code              | `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`)                                                                                               | `mcpServers.agentq` (user scope)                 |
| Codex                    | `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`)                                                                                                 | `[mcp_servers.agentq]`                           |
| OpenCode                 | `~/.config/opencode/opencode.json` (or `$XDG_CONFIG_HOME/opencode/…`, `.jsonc`)                                                                       | `mcp.agentq` (`type: "local"`)                   |
| Gemini CLI               | `~/.gemini/settings.json`                                                                                                                             | `mcpServers.agentq`                              |
| GitHub Copilot CLI       | `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`)                                                                                     | `mcpServers.agentq` (`type: "local"`, all tools) |
| GitHub Copilot (VS Code) | `mcp.json` in the VS Code user folder: `%APPDATA%\Code\User` (Windows), `~/Library/Application Support/Code/User` (macOS), `~/.config/Code/User` (Linux) | `servers.agentq` (`type: "stdio"`)               |

A tool counts as installed when its binary is on `PATH` (`copilot` for the Copilot CLI, `code` for VS Code) or its config folder exists. The VS Code entry goes in the default profile's user configuration (the file **MCP: Open User Configuration** opens), so the server is available in every workspace; VS Code asks you to trust it the first time it starts. VS Code does not read `~/.copilot/mcp-config.json` unless `chat.mcp.discovery.enabled` is on, which is why it gets its own entry. A file that cannot be edited safely (for example a JSON file with comments) is left untouched: the command prints the block to paste by hand and exits with code 1. Files saved on Windows with a UTF-8 BOM or CRLF line endings are read normally.

`bun test packages/installer` includes an end-to-end test that runs the real `install:all` against a throwaway home folder and starts the registered server like an MCP client would; the `Installer` GitHub Actions workflow runs it on Linux, macOS and Windows.

Runners do not need this step: every runner job gets its own server config (see [runner.md](runner.md)).

## Tools

Every tool returns JSON both as a text content block and as `structuredContent`. Successful results carry `success: true`; failures return `{ "success": false, "error": "..." }` with `isError: true`, using the workflow's messages (`Task not found.`, `Task must be in Planning status.`, ...). Arguments that fail validation (a missing field, an unknown role) come back as an `isError` result whose text starts with `MCP error -32602: Input validation error`.

Clients prefix the names: in Claude Code `claim_task` is `mcp__agentq__claim_task`, in OpenCode `agentq_claim_task`.

| Tool            | Description                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim_task`    | Atomically claim the highest-priority task eligible for your role and move it to `planning`, `coding`, `reviewing` or `merging`. Returns `{ success, task, agent }` or `{ success: false, reason: "no_tasks_available" }`. |
| `submit_plan`   | Submit a plan for a task in `planning`; moves it to `waiting_plan_review` and releases it.                                                                                                                                 |
| `submit_code`   | Submit code for a task in `coding`; stores the worktree path, moves it to `waiting_code_review` and releases it.                                                                                                           |
| `submit_review` | Submit review findings for a task in `reviewing`; moves it back to `waiting_code_review` and releases it.                                                                                                                  |
| `submit_merge`  | Record a merge (branch, commit, authors) for a task in `merging`; moves it to `merged` and releases it.                                                                                                                    |
| `get_task`      | Fetch a task by ID with its project.                                                                                                                                                                                       |
| `list_tasks`    | List tasks with their project, optionally filtered by `status` and `projectId`. Archived tasks are left out (the `agentq-archive` skill uses it to find `complete` tasks).                                                 |
| `list_projects` | List all projects.                                                                                                                                                                                                         |
| `create_task`   | Create a task. `guardrails` and `acceptanceCriteria` are arrays; entries are trimmed and empty ones dropped.                                                                                                               |
| `post_comment`  | Append an `agent` conversation entry and a `comment_added` activity event without changing the status.                                                                                                                     |
| `archive_task`  | Archive a `complete` task: write `<name>.summary.md` and `<name>.detailed.md` to `{project.workingDirectory}/archive/` (or `directory`) and take the task off the board. Same as the board's **Archive** button.          |

Tool inputs:

| Tool            | Required                                                                                                                  | Optional                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `claim_task`    | `toolName`, `version`, `model`, `role` (`planner` \| `implementer` \| `reviewer` \| `senior` \| `architect`), `sessionId` | `host`, `projectId`, `context`                                                                                         |
| `submit_plan`   | `taskId`, `message`, `context`                                                                                            | `author`                                                                                                               |
| `submit_code`   | `taskId`, `message`, `worktree`, `context`                                                                                | `author`                                                                                                               |
| `submit_review` | `taskId`, `message`, `context`                                                                                            | `author`                                                                                                               |
| `submit_merge`  | `taskId`, `mergeBranch`, `commit`, `authors`, `context`                                                                   | `message`, `worktree`, `author`                                                                                        |
| `get_task`      | `taskId`                                                                                                                  |                                                                                                                        |
| `list_tasks`    |                                                                                                                           | `status`, `projectId`                                                                                                  |
| `list_projects` |                                                                                                                           |                                                                                                                        |
| `create_task`   | `title`, `projectId`, `description`                                                                                       | `steerDetails`, `guardrails[]`, `acceptanceCriteria[]`, `priority`, `branch`, `requiresPlan`, `mergeBranch`, `context` |
| `post_comment`  | `taskId`, `message`                                                                                                       | `author`                                                                                                               |
| `archive_task`  | `taskId`                                                                                                                  | `pullRequests[]`, `overview`, `force`, `directory`, `author`                                                           |

A runner job only needs `get_task`, `post_comment` and the four `submit_*` tools (`RUNNER_MCP_TOOLS` in `packages/mcp/src/launch.ts`); those are the ones a safe-mode Claude Code runner allows.

## Resources

| URI                      | Content                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `agentq://task/{taskId}` | The task with its `project`, as JSON (same shape as `get_task`'s `task`). |
| `agentq://projects`      | All projects, as a JSON array.                                            |

## Protocol

The server's `instructions` summarise the loop agents follow: `claim_task` → read `task.status` → plan / code / review / merge in `task.project.workingDirectory` → `submit_*` → `claim_task` again, stopping when `no_tasks_available`. Every `submit_*` call must pass a non-blank `context`: handoff notes for the agent of the next phase (decisions, gotchas, what to check next), appended to `task.contexts`; on `claim_task` it is optional. Agents write messages in Markdown and work autonomously without asking the user for permission. A runner job skips the claim: the runner already claimed the task. There is no heartbeat or lease: a claimed task stays assigned until it is submitted, a runner releases it, or a user unblocks it from the web UI.

The workflow skills in `skills/` (`bun run install:skills`) describe the same protocol per phase.

## Launch spec

`packages/mcp/src/launch.ts` is the single place that knows how to start the server: `mcpServerLaunch(dbPath)` returns `{ command, args, env }` (bun, `run <entry>`, `AGENTQ_DB_PATH`). MCP clients start servers with a minimal environment, so the database path always travels in `env`. `install:mcp` and the runner both build their configs from it.

## Development

```bash
bun test packages/mcp                       # in-memory + stdio tests
bun x tsc --project packages/mcp --noEmit   # typecheck (also part of `bun run typecheck`)
```

Tests never touch `~/.agentq/agentq.db`: they set `AGENTQ_DB_PATH=:memory:` in-process and a temp file for the spawned stdio server.
