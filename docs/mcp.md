# AgentQ MCP Server

`packages/mcp` exposes the AgentQ agent protocol as an [MCP](https://modelcontextprotocol.io) server over stdio. It is a complement to the `agentq` CLI, not a replacement: both open the same SQLite database (`AGENTQ_DB_PATH`, default `~/agentq/agentq.db`) and call the same shared functions in `@agentq/shared`, so a task claimed via MCP can be submitted via the CLI and vice versa. No web server needs to be running.

Run it directly from the repo:

```bash
bun run mcp          # same as: bun run packages/mcp/src/index.ts
```

The server prints nothing on stdout except the protocol; diagnostics go to stderr.

## Registering the server

Replace `/abs/path/to/agent-task-queue` with the absolute path of your checkout.

### Claude Code

```bash
claude mcp add agentq -- bun run /abs/path/to/agent-task-queue/packages/mcp/src/index.ts
```

Add `--scope user` to make it available in every project. To point it at another database, pass `-e AGENTQ_DB_PATH=/path/to/agentq.db` before `--`.

### Codex

```bash
codex mcp add agentq -- bun run /abs/path/to/agent-task-queue/packages/mcp/src/index.ts
```

### OpenCode

Add an `mcp` block to `opencode.json` (project or `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agentq": {
      "type": "local",
      "command": ["bun", "run", "/abs/path/to/agent-task-queue/packages/mcp/src/index.ts"],
      "enabled": true
    }
  }
}
```

Set `"environment": { "AGENTQ_DB_PATH": "/path/to/agentq.db" }` inside the entry to override the database.

### Compiled binary (idea, not implemented)

An `install:mcp` script could compile the server with `bun build --compile packages/mcp/src/index.ts --outfile ~/.local/bin/agentq-mcp` (like `install:bin` does for the CLI) so the registration commands become `claude mcp add agentq -- agentq-mcp`. Until then, register the `bun run` form above.

## Tools

Every tool returns JSON both as a text content block and as `structuredContent`. Successful results carry `success: true`; failures return `{ "success": false, "error": "..." }` with `isError: true`, using the same messages as the CLI (`Task not found.`, `Task must be in Planning status.`, ...).

| Tool            | CLI equivalent                | Description                                                                                                                                                                                                                |
| --------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim_task`    | `agentq claim --json`         | Atomically claim the highest-priority task eligible for your role and move it to `planning`, `coding`, `reviewing` or `merging`. Returns `{ success, task, agent }` or `{ success: false, reason: "no_tasks_available" }`. |
| `submit_plan`   | `agentq submit-plan --json`   | Submit a plan for a task in `planning`; moves it to `waiting_plan_review` and releases it.                                                                                                                                 |
| `submit_code`   | `agentq submit-code --json`   | Submit code for a task in `coding`; stores the worktree path, moves it to `waiting_code_review` and releases it.                                                                                                           |
| `submit_review` | `agentq submit-review --json` | Submit review findings for a task in `reviewing`; moves it back to `waiting_code_review` and releases it.                                                                                                                  |
| `submit_merge`  | `agentq submit-merge --json`  | Record a merge (branch, commit, authors) for a task in `merging`; moves it to `merged` and releases it.                                                                                                                    |
| `get_task`      | `agentq get --json`           | Fetch a task by ID with its project.                                                                                                                                                                                       |
| `list_projects` | `agentq projects --json`      | List all projects.                                                                                                                                                                                                         |
| `create_task`   | `agentq create --json`        | Create a task (`guardrails` and `acceptanceCriteria` are arrays instead of `\|`-separated strings).                                                                                                                        |
| `post_comment`  | —                             | Append an `agent` conversation entry and a `comment_added` activity event without changing the status.                                                                                                                     |
| `archive_task`  | `agentq archive --json`       | Archive a `complete` task: write `<name>.summary.md` and `<name>.detailed.md` to `{project.workingDirectory}/archive/` and take the task off the board. Same as the board's **Archive** button.                                  |

Tool inputs:

| Tool            | Required                                                                                                                  | Optional                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `claim_task`    | `toolName`, `version`, `model`, `role` (`planner` \| `implementer` \| `reviewer` \| `senior` \| `architect`), `sessionId` | `host`, `projectId`, `context`                                                                                         |
| `submit_plan`   | `taskId`, `message`                                                                                                       | `author`, `context`                                                                                                    |
| `submit_code`   | `taskId`, `message`, `worktree`                                                                                           | `author`, `context`                                                                                                    |
| `submit_review` | `taskId`, `message`                                                                                                       | `author`, `context`                                                                                                    |
| `submit_merge`  | `taskId`, `mergeBranch`, `commit`, `authors`                                                                              | `message`, `worktree`, `author`, `context`                                                                             |
| `get_task`      | `taskId`                                                                                                                  |                                                                                                                        |
| `list_projects` |                                                                                                                           |                                                                                                                        |
| `create_task`   | `title`, `projectId`, `description`                                                                                       | `steerDetails`, `guardrails[]`, `acceptanceCriteria[]`, `priority`, `branch`, `requiresPlan`, `mergeBranch`, `context` |
| `post_comment`  | `taskId`, `message`                                                                                                       | `author`                                                                                                               |
| `archive_task`  | `taskId`                                                                                                                  | `pullRequests[]`, `overview`, `force`, `author`                                                                        |

## Resources

| URI                      | Content                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `agentq://task/{taskId}` | The task with its `project`, as JSON (same shape as `get_task`'s `task`). |
| `agentq://projects`      | All projects, as a JSON array.                                            |

## Protocol

The server's `instructions` summarise the loop agents follow: `claim_task` → read `task.status` → plan / code / review / merge in `task.project.workingDirectory` → `submit_*` → `claim_task` again, stopping when `no_tasks_available`. Agents work autonomously and never ask the user for permission. There is no heartbeat or lease: a claimed task stays assigned until it is submitted, or a user unblocks it from the web UI.

## Development

```bash
bun test packages/mcp                       # in-memory + stdio tests
bunx tsc --project packages/mcp --noEmit    # typecheck (also part of `bun run typecheck`)
```

Tests never touch `~/agentq/agentq.db`: they set `AGENTQ_DB_PATH=:memory:` in-process and a temp file for the spawned stdio server.
