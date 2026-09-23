# Runners

A **runner** is the piece of AgentQ that removes the "open Claude / Codex / OpenCode by
hand" step. It lives inside the web server, polls the queue with a role, and every time
it claims a task it launches the configured coding tool **headless** in the project's
working directory with a prompt that contains the task and the matching phase skill.
Every job gets the AgentQ MCP server, bound to the web server's database, with no setup
on your side. The tool does the work and finishes by calling the phase's `submit_*` MCP
tool; the runner only watches the process.

Demo flow: create a task on the board → a runner picks it up within `poll_interval_sec`
seconds → the plan shows up in *Need Review* → you approve → the same (or another)
runner picks it up for coding → a PR.

## Managing runners

Web UI: **Runners** (sidebar, between Agents and Activity). Each card shows the tool,
role, project, running/stopped state with a Start/Stop button, active job count and the
outcome of the last job. Clicking a card opens the job list with a live log panel.

REST:

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/runners` | Config + live state (`state.running`, `activeJobs`, `lastError`, `lastJob`) |
| `POST` | `/api/runners` | Create (`enabled: true` starts it immediately) |
| `GET` / `PUT` / `DELETE` | `/api/runners/:id` | Read / update / delete (delete stops it first and releases its tasks) |
| `POST` | `/api/runners/:id/start` | Start and persist `enabled = true` |
| `POST` | `/api/runners/:id/stop` | Stop (SIGTERM, SIGKILL after 10 s), release its tasks, persist `enabled = false` |
| `GET` | `/api/runners/:id/jobs` | Job history (newest first, last 50) |
| `GET` | `/api/runners/:id/jobs/:jobId/log?tail=200` | Log tail as `text/plain` |
| `GET` | `/api/runners/tools` | `[{ tool, installed, version }]` for claude, codex, opencode, gemini, custom |

Runners persisted as `enabled` are started when the server boots; `SIGINT`/`SIGTERM`
stops them and releases their tasks before the server exits.

Runner fields: `name`, `tool`, `role` (planner / implementer / reviewer / senior /
architect), `projectId` (null = any project), `model`, `concurrency` (parallel jobs,
default 1), `pollIntervalSec` (default 5), `permissionMode` (`safe` / `full`),
`extraArgs` (string array), `enabled`.

## Tools and the commands they run

The runner writes the prompt to `~/.agentq/runs/<taskId>/<jobId>.prompt.md`, the job's MCP
config to `<jobId>.mcp.json` next to it, and runs:

| Tool | Command |
|------|---------|
| `claude` | `claude -p <prompt> --output-format json --mcp-config <jobId>.mcp.json` + permission flags + `--model <m>` + `--effort <e>` + extra args |
| `codex` | `codex exec --full-auto -C <cwd> --skip-git-repo-check -c mcp_servers.agentq.command=… -c mcp_servers.agentq.args=… -c mcp_servers.agentq.env=… [-m model] [-c model_reasoning_effort="<e>"] <extra args> <prompt>` |
| `opencode` | `opencode run --dir <cwd> --format json --auto [-m provider/model] [--variant <e>] <extra args> <prompt>` with `OPENCODE_CONFIG_CONTENT` set |
| `gemini` | `gemini -p <prompt> --yolo [-m model] <extra args>` with `GEMINI_CLI_SYSTEM_SETTINGS_PATH` set |
| `custom` | `extraArgs` **is** the argv; the prompt is appended as the last argument and exposed as `$AGENTQ_PROMPT` |

Every child gets `AGENTQ_TASK_ID`, `AGENTQ_ROLE`, `AGENTQ_PROMPT_FILE`,
`AGENTQ_MCP_CONFIG` (the job's MCP config file) and `AGENTQ_DB_PATH` (the web server's
database) in its environment. `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` are removed so a runner started
from inside a Claude Code session does not trip the nested-session guard. The working
directory is the project's `workingDirectory` (with `~` expanded); if it does not exist
the task is released immediately and the job is marked reverted.

### The AgentQ MCP server in every job

Before starting the tool, the runner writes `<jobId>.mcp.json`:

```json
{ "mcpServers": { "agentq": { "command": "<bun>", "args": ["run", "<checkout>/packages/mcp/src/index.ts"],
                              "env": { "AGENTQ_DB_PATH": "<the web server's database>" } } } }
```

and hands the same server to the tool the way that tool reads MCP config for a single run,
so nothing has to be registered beforehand (`bun run install:mcp` is only needed to use
AgentQ from a tool you open yourself):

| Tool | How the job gets the server |
|------|-----------------------------|
| `claude` | `--mcp-config <jobId>.mcp.json`. It is added to the servers you configured, and a server passed this way takes precedence over one with the same name. |
| `codex` | `-c mcp_servers.agentq.command=…`, `…args=…` and `…env={ "AGENTQ_DB_PATH" = … }` overrides (TOML values). |
| `opencode` | `OPENCODE_CONFIG_CONTENT` (inline config, highest precedence) with an `mcp.agentq` local server, merged into any content the variable already holds. |
| `gemini` | Gemini CLI has no per-run MCP flag, so the job writes `<jobId>.gemini-settings.json`: a copy of the system settings file (`$GEMINI_CLI_SYSTEM_SETTINGS_PATH`, else `/etc/gemini-cli/settings.json`, `/Library/Application Support/GeminiCli/settings.json` or `C:\ProgramData\gemini-cli\settings.json`) with `mcpServers.agentq` added, and points `GEMINI_CLI_SYSTEM_SETTINGS_PATH` at it. Admin settings are kept. If the system settings file exists but is not valid JSON, the job fails before the tool starts, the task is released and the error names the file to fix. |
| `custom` | Your argv decides. Read `$AGENTQ_MCP_CONFIG` (the `mcpServers` document above, usable as-is with `claude --mcp-config`), or start `bun run packages/mcp/src/index.ts` with `AGENTQ_DB_PATH=$AGENTQ_DB_PATH`. A custom tool that never submits has its task released when it exits. |

The job log starts with the path of the MCP config the job received.

### Model & effort discovery

The runner form does not ask you to type a model name: `GET
/api/runners/tools/<tool>/models` returns `{ tool, source, models, efforts, defaultEffort }`
and the UI turns it into a select (plus a `Custom...` entry that reveals a free-text
field) and, when the tool has an effort flag, an effort select. Each `models[]` entry is
`{ id, label, description?, efforts?, defaultEffort? }`; a per-model `efforts` list
overrides the tool-level one.

| Tool | Models | Efforts |
|------|--------|---------|
| `claude` | Aliases quoted in `claude --help` (`fable`, `opus`, `sonnet`, plus `haiku`), the entries of `additionalModelOptionsCache` in `~/.claude.json`, then the static full IDs (`claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`) | Parsed from the `--effort <level>` line of `--help` → `--effort <e>` |
| `codex` | `codex debug models` (only `visibility: "list"`, highest `priority` first) with each model's `supported_reasoning_levels`; the `model` / `model_reasoning_effort` set at the top of `~/.codex/config.toml` is prepended as `<model> (configured)` when `codex` does not list it | Union of every model's levels → `-c model_reasoning_effort="<e>"` |
| `opencode` | `opencode models`, one `provider/model` per line, grouped by provider | Fixed `minimal, low, medium, high, max` → `--variant <e>` |
| `gemini` | Static `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`; the `model` in `~/.gemini/settings.json` is prepended as `(configured)` | none |
| `custom` | none (free text only) | none |

`source` tells where the list came from: `cli` (the tool was executed), `cache` (served
from the in-memory cache, kept per tool for 10 minutes) or `static` (the tool is missing,
timed out after 15 s or printed something unparsable, so only the built-in and configured
entries are shown). The "Refresh" link under the model select calls the route with
`?refresh=1`, which bypasses the cache. Discovery never fails the request: a broken tool
just degrades to `static`.

The chosen effort is stored on the runner (`effort`, nullable) and only handed to tools
that understand it; `gemini` and `custom` ignore it.

### Permission modes

- **safe** (default) — the tool may edit files, run a fixed allow-list of commands and
  call the AgentQ tools a claimed job needs. For Claude Code: `--permission-mode
  acceptEdits --allowedTools mcp__agentq__get_task mcp__agentq__post_comment
  mcp__agentq__submit_plan mcp__agentq__submit_code mcp__agentq__submit_review
  mcp__agentq__submit_merge "Bash(git:*)" "Bash(gh:*)" "Bash(bun:*)" "Bash(npm:*)"
  "Bash(npx:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(grep:*)" "Bash(find:*)" Edit Write Read
  Glob Grep`. `claim_task`, `create_task`, `list_tasks` and `archive_task` are not
  allowed: the runner already claimed the task. Codex runs with `--full-auto` (sandboxed
  workspace-write; its MCP servers run outside the sandbox, so the AgentQ server can write
  the database).
- **full** — no prompts, no sandbox: Claude gets `--dangerously-skip-permissions`, Codex
  `--dangerously-bypass-approvals-and-sandbox`. Use only for repositories you trust the
  agent to operate in unattended.

### The prompt

`buildPrompt()` tells the tool it is an AgentQ `<role>` agent, that task `<id>` was
**already claimed for it** (so it must not call `claim_task`), the current status, the
AgentQ MCP tools it can use (`get_task`, `post_comment` and the phase's `submit_*`), the
full task JSON (title, description, steerDetails, guardrails, acceptanceCriteria,
conversation, contexts, branches, worktreePath, project working directory), the body of
`skills/agentq-<phase>/SKILL.md` (frontmatter stripped) inline, the exact submit tool and
arguments to finish with (a Markdown message plus the required `context` handoff notes,
with a per-phase hint of what they should contain), never to ask for permission, and to
stop once the submit succeeds.

Phase by status: `plan_requested` / `plan_changes_requested` → plan,
`ready_for_code` / `changes_requested` → code, `code_review_requested` → review,
`approved` → merge.

## What happens when the tool exits

The runner is the parent of the tool process, so the process exiting is the abandonment
signal — there is deliberately **no heartbeat or lease**.

When the child exits the runner re-reads the task:

- The task moved on (status changed or it is no longer assigned to this runner's agent)
  → the agent submitted; the job is `succeeded` (exit 0) or `failed`.
- The task is still in the active status (`planning`, `coding`, `reviewing`, `merging`)
  and assigned to this runner's agent → `revertClaim()` releases it back to the status
  it was claimed from (the last history entry's `pre_status` when valid, otherwise
  planning→`plan_requested`, coding→`ready_for_code`, reviewing→`code_review_requested`,
  merging→`approved`), records history, adds a **system** conversation entry with the
  exit code and the last 30 lines of output, and logs a `task_reverted` activity event.
  The job is `reverted`.

The same revert runs when a job is killed by Stop, by server shutdown, or by the job
timeout. On Windows the whole process tree is ended (`taskkill /T /F`), so the tool's MCP
servers and shell children go with it. On every platform the runner stops reading output
2 s after the tool exits, even if a leftover child still holds the pipes open. After a revert the engine backs off before claiming the same task again
(30 s, doubling per consecutive revert, capped at 30 min) so a crashing tool is not
relaunched in a tight loop; the counter resets when a job for that task succeeds.

## Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `AGENTQ_HOME` | `~/.agentq` | Root for run artifacts (`<home>/runs/<taskId>/<jobId>.log` and `.prompt.md`) |
| `AGENTQ_JOB_TIMEOUT_MIN` | `60` | Kill a job that runs longer than this and release its task |
| `AGENTQ_DB_PATH` | `~/.agentq/agentq.db` | Database; every job's AgentQ MCP server is bound to it |

## Live updates

SSE (`/api/events`) carries, in addition to `task_created` / `task_updated`:

- `runner_updated` — a runner's live state (`{ id, running, activeJobs, lastError, lastJob, jobCount }`)
- `runner_job` — `{ type: "started" | "finished", runnerId, jobId, job }` and
  `{ type: "output", runnerId, jobId, taskId, chunk }` (output is batched, at most ~10/s per job)
- `runner_deleted` — `{ id }`

Because the agents' MCP servers write straight to SQLite, the server also watches `tasks.updated_at`
every 1.5 s while at least one SSE client is connected and re-broadcasts changed tasks
as `task_updated`, so claims and submissions made by agents show up on the board.

## Demo script

```bash
# 1. start the server (any spare port, throwaway DB)
AGENTQ_DB_PATH=/tmp/agentq-demo.db PORT=3999 bun run packages/web/src/index.ts

# 2. a project pointing at a real checkout
curl -s localhost:3999/api/projects -H 'content-type: application/json' -d '{
  "id": "'"$(uuidgen | tr A-Z a-z)"'", "displayName": "My repo", "workingDirectory": "~/code/my-repo"
}'

# 3. a senior runner on Claude Code (picks up planning, coding, review and merge)
curl -s localhost:3999/api/runners -H 'content-type: application/json' -d '{
  "name": "claude-senior", "tool": "claude", "role": "senior", "permissionMode": "safe", "enabled": true
}'

# 4. create a task on the board (requires plan) and watch:
#    plan_requested → planning (runner) → waiting_plan_review → approve in the UI →
#    ready_for_code → coding (runner) → waiting_code_review → approve → merging → merged
```

For tests, use `tool: "custom"` with `extraArgs` such as
`["bun", "packages/web/src/runner/testing/fake-agent.ts", "submit_plan", "{\"message\":\"## Plan\"}"]`:
the fake agent starts the server from `$AGENTQ_MCP_CONFIG` and calls the tool for
`$AGENTQ_TASK_ID`, as a real coding tool would.
