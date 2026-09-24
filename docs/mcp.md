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
| `claim_task`    | Atomically claim the highest-priority task eligible for your role and move it to `planning`, `coding`, `reviewing` or `merging`. Returns `{ success, task, agent, claimToken, skillsVersion, skills }`, `{ success: false, reason: "no_tasks_available" }` or, for agents whose skills are older than the server supports, `{ success: false, reason: "skills_outdated" }`. |
| `submit_plan`   | Submit a plan for a task in `planning`, with its `validationPlan` (how each criterion is verified, regression commands); moves it to `waiting_plan_review` and releases it. Approval freezes it as `task.approvedPlan`. |
| `submit_code`   | Submit code for a task in `coding` with `evidence`, per-criterion status and an answer for every open finding; stores the worktree, branch and head commit and releases it. With project commands it goes to `verify_requested` (the built-in verifier); otherwise to review (AI under L1+, a person under L0). |
| `submit_review` | Submit a `verdict` (`approve`, `request_changes`, `needs_human`) and structured `findings` for a task in `reviewing`. The verdict routes the task under the project's autonomy level (see [policy.md](policy.md)); under L0 it goes back to `waiting_code_review`. Approve is refused while blocker/major findings are open. |
| `submit_merge`  | Record a merge (branch, commit, authors) for a task in `merging`; moves it to `merged` and releases it.                                                                                                                    |
| `report_blocker` | Stop working on a claimed task because something outside the agent's control blocks it (push rejected, missing credentials, contradictory task). Moves it to `needs_human` with the reason and question, and releases it: nothing retries it until a person answers from the portal. |
| `get_task`      | Fetch a task by ID with its project, its review `findings` and its `evidence`.                                                                                                                                           |
| `heartbeat`     | Extend the lease of a claim made by a hand-opened session (any call from the session already does).                                                                                                                      |
| `submit_verification` | For verifier agents: report a task in `verifying` (`passed`, `evidence`, `tampering`). The built-in verifier calls the same workflow directly.                                                                     |
| `list_tasks`    | List tasks with their project, optionally filtered by `status` and `projectId`. Archived tasks are left out (the `agentq-archive` skill uses it to find `complete` tasks).                                                 |
| `list_projects` | List all projects.                                                                                                                                                                                                         |
| `create_task`   | Create a task. `acceptanceCriteria` entries are strings (`"text $ command"` makes the command its check) or `{ text, verify: { kind, command } }`; each gets an id (`AC1`…). `guardrails` entries are trimmed and empty ones dropped. Without `mergeBranch` the task targets the project's default branch (detected from `origin/HEAD`). Logs `task_created`. |
| `post_comment`  | Append an `agent` conversation entry and a `comment_added` activity event without changing the status.                                                                                                                     |
| `archive_task`  | Archive a `complete` task: write `<name>.summary.md` and `<name>.detailed.md` to `{project.workingDirectory}/archive/` (or `directory`) and take the task off the board. Same as the board's **Archive** button.          |

Tool inputs:

| Tool            | Required                                                                                                                  | Optional                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `claim_task`    | `toolName`, `version`, `model`, `role` (`planner` \| `implementer` \| `reviewer` \| `senior` \| `architect`), `sessionId` | `host`, `projectId`, `skillsVersion`, `context`                                                                        |
| `submit_plan`   | `taskId`, `message`, `context`                                                                                            | `validationPlan` (`items[]`: `criterionId`, `how`, `command`, `newTests`; `regressionCommands[]`), `author`, `claimToken`, `agentId` |
| `submit_code`   | `taskId`, `message`, `worktree`, `context`                                                                                | `branch`, `headSha`, `evidence[]`, `criteria[]`, `findingResolutions[]` (required for open findings), `author`, `claimToken`, `agentId` |
| `submit_review` | `taskId`, `verdict`, `message`, `context`                                                                                 | `findings[]` (`severity`, `file`, `line`, `text`), `verifiedFindings[]` (`id`, `status`), `question`, `author`, `claimToken`, `agentId` |
| `submit_merge`  | `taskId`, `mergeBranch`, `commit`, `authors`, `context`                                                                   | `message`, `worktree`, `author`, `claimToken`, `agentId`                                                               |
| `report_blocker` | `taskId`, `reason`, `question`                                                                                           | `context`, `author`, `claimToken`, `agentId`                                                                           |
| `get_task`      | `taskId`                                                                                                                  |                                                                                                                        |
| `heartbeat`     | `taskId`                                                                                                                  | `claimToken`                                                                                                           |
| `list_tasks`    |                                                                                                                           | `status`, `projectId`                                                                                                  |
| `list_projects` |                                                                                                                           |                                                                                                                        |
| `create_task`   | `title`, `projectId`, `description`                                                                                       | `steerDetails`, `guardrails[]`, `acceptanceCriteria[]`, `priority`, `branch`, `requiresPlan`, `mergeBranch`, `context`, `author` |
| `post_comment`  | `taskId`, `message`                                                                                                       | `author`                                                                                                               |
| `archive_task`  | `taskId`                                                                                                                  | `pullRequests[]`, `overview`, `force`, `directory`, `author`                                                           |

A runner job only needs `get_task`, `post_comment`, the four `submit_*` tools and `report_blocker` (`RUNNER_MCP_TOOLS` in `packages/mcp/src/launch.ts`); those are the ones a safe-mode Claude Code runner allows.

### Claim tokens

Every claim gets a `claimToken`, stored on the task and returned once by `claim_task` (it is never included in `get_task`, `list_tasks` or the task resource). `submit_*` and `report_blocker` are refused unless they present it, so an agent whose task was unblocked and claimed by someone else cannot overwrite the new claim. The server remembers the tokens of the claims made in its session, so a hand-opened agent does not have to pass it; a runner job's server starts out holding the job's claim (`AGENTQ_TASK_ID` / `AGENTQ_CLAIM_TOKEN` in its launch env), and the runner also writes the token into the prompt. Tasks claimed before tokens existed (no token stored) accept submits as before.

## Resources

| URI                      | Content                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `agentq://task/{taskId}` | The task with its `project`, as JSON (same shape as `get_task`'s `task`). |
| `agentq://projects`      | All projects, as a JSON array.                                            |

## Protocol

The server's `instructions` summarise the loop agents follow: `claim_task` → read `task.status` → plan / code / review / merge in `task.project.workingDirectory` → `submit_*` (or `report_blocker` when blocked) → `claim_task` again, stopping when `no_tasks_available`. They also name the skills bundle version the server ships; agents with older `agentq-*` skills stop and ask the user to run `bun run install:skills`. Every `submit_*` call must pass a non-blank `context`: handoff notes for the agent of the next phase (decisions, gotchas, what to check next), appended to `task.contexts`; on `claim_task` it is optional. Agents write messages in Markdown and work autonomously without asking the user for permission. A runner job skips the claim: the runner already claimed the task. Runner claims last as long as their process. A claim made by a hand-opened session has a lease (90 min by default, per project): every AgentQ call from the session extends it and `heartbeat` does so explicitly; when it expires the server returns the task to the queue. `claim_task` never gives an agent the review of code its own session wrote (see [policy.md](policy.md)); its result also carries the project's `autonomy` level and the review `round`.

The workflow skills in `skills/` (`bun run install:skills`) describe the same protocol per phase.

## Launch spec

`packages/mcp/src/launch.ts` is the single place that knows how to start the server: `mcpServerLaunch(dbPath, bunPath?, extraEnv?)` returns `{ command, args, env }` (bun, `run <entry>`, `AGENTQ_DB_PATH` plus `extraEnv`); `claimEnv(taskId, claimToken, agentId)` is the extra env a runner job passes. MCP clients start servers with a minimal environment, so the database path always travels in `env`. `install:mcp` and the runner both build their configs from it.

## Development

```bash
bun test packages/mcp                       # in-memory + stdio tests
bun x tsc --project packages/mcp --noEmit   # typecheck (also part of `bun run typecheck`)
```

Tests never touch `~/.agentq/agentq.db`: they set `AGENTQ_DB_PATH=:memory:` in-process and a temp file for the spawned stdio server.
