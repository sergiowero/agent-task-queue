# Runners

A **runner** is the piece of AgentQ that removes the "open Claude / Codex / OpenCode by
hand" step. It lives inside the web server, polls the queue with its roles, and every time
it claims a task it launches the configured coding tool **headless** in the project's
working directory with a prompt that contains the task and the matching phase skill.
Every job gets the AgentQ MCP server, bound to the web server's database, with no setup
on your side. The tool does the work and finishes by calling the phase's `submit_*` MCP
tool; the runner only watches the process.

Demo flow: create a task on the board → a runner picks it up within `poll_interval_sec`
seconds → the plan shows up in *Needs you* → you approve → the same (or another)
runner picks it up for coding → a PR.

## Managing runners

Web UI: **Runners** (sidebar, between Agents and Activity). Each card shows the tool,
roles, project, running/stopped state with a Start/Stop button, active job count and the
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

Runner fields: `name`, `tool`, `roles` (one or more of `refine`, `plan`, `plan_review`,
`code`, `verify`, `review`, `pr`; the form starts with all but `verify`), `projectId`
(null = any project), `model`, `concurrency` (parallel jobs, default 1),
`pollIntervalSec` (default 5), `permissionMode` (`safe` / `full`), `extraArgs` (string
array), `enabled`. A runner claims the tasks of any of its roles; roles are stored
without duplicates, in that order.

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

### Model & effort

The model is a free-text field: whatever you type is passed to the tool as-is
(`--model` for `claude`, `-m` for `codex`, `opencode` and `gemini`). Leave it empty and
no model flag is passed at all, so the tool uses its own default (its config file or
built-in choice). AgentQ does not list or validate models.

The effort is a select with a fixed list per tool, stored on the runner (`effort`,
nullable) and only handed to tools that understand it:

| Tool | Efforts | Flag |
|------|---------|------|
| `claude` | `low, medium, high, xhigh, max` | `--effort <e>` |
| `codex` | `low, medium, high, xhigh, max` | `-c model_reasoning_effort="<e>"` |
| `opencode` | `minimal, low, medium, high, max` | `--variant <e>` |
| `gemini`, `custom` | none (ignored) | |

Empty means the tool's default effort.

### Permission modes

- **safe** (default) — the tool may edit files, run a fixed allow-list of commands and
  call the AgentQ tools a claimed job needs. For Claude Code: `--permission-mode
  acceptEdits --allowedTools mcp__agentq__get_task mcp__agentq__post_comment
  mcp__agentq__submit_plan mcp__agentq__submit_code mcp__agentq__submit_review
  mcp__agentq__submit_pr mcp__agentq__submit_merge "Bash(git:*)" "Bash(gh:*)" "Bash(bun:*)" "Bash(npm:*)"
  "Bash(npx:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(grep:*)" "Bash(find:*)" Edit Write Read
  Glob Grep`. `claim_task`, `create_task`, `list_tasks` and `archive_task` are not
  allowed: the runner already claimed the task. Codex runs with `--full-auto` (sandboxed
  workspace-write; its MCP servers run outside the sandbox, so the AgentQ server can write
  the database).
- **full** — no prompts, no sandbox: Claude gets `--dangerously-skip-permissions`, Codex
  `--dangerously-bypass-approvals-and-sandbox`. Use only for repositories you trust the
  agent to operate in unattended.

### The prompt

`buildPrompt()` tells the tool which of the runner's roles the claim acts as (also in
`$AGENTQ_ROLE`), that task `<id>` was
**already claimed for it** (so it must not call `claim_task`), the current status, the
AgentQ MCP tools it can use (`get_task_brief`, `get_task`, `post_comment`, the phase's
`submit_*` and `report_blocker`), the task **brief** (see [mcp.md](mcp.md): plan,
criteria, open findings, latest handoffs, human notes; not the whole conversation, so
the prompt does not grow round after round; for a plan critique, verification or review
job, the **independent brief**, without the author's conversation, handoffs, messages
or evidence, see [policy.md](policy.md#independent-checks)), the
body of
`skills/agentq-<phase>/SKILL.md` (frontmatter stripped) inline, the exact submit tool and
arguments to finish with (a Markdown message plus the required `context` handoff notes,
with a per-phase hint of what they should contain, and the job's `claimToken`), how to call
`report_blocker` when something outside its control blocks the phase (never submit
partial work), never to ask for permission, and to stop once the submit succeeds.

Phase by status (each phase has its skill, `skills/agentq-<phase>`): `draft` → refine,
`plan_requested` / `plan_changes_requested` → plan, `plan_review_requested` →
plan-review, `ready_for_code` / `changes_requested` → code, `verify_requested` →
verify, `code_review_requested` → review, `approved` → merge (role `pr`). Runners from
before roles were lists were migrated: each old role became its list (`senior` → every
role but `verify`, `architect` → `plan`, `plan_review`, `review`, `qa` → `verify`,
`review`, `builder` → `code`, `pr`, and each base role its phase name).

## What happens when the tool exits

The runner is the parent of the tool process, so the process exiting is the abandonment
signal — there is deliberately **no heartbeat or lease**.

When the child exits the runner re-reads the task:

- The task moved to `needs_human` from the job's status → the agent called
  `report_blocker`; the job is `blocked` and the task waits for a person (no retry).
- The task moved on otherwise (status changed, or it no longer carries the job's claim token)
  → the agent submitted, or a person took the task away; the job is `succeeded` (exit 0) or `failed`.
- The task is still in the active status (`planning`, `coding`, `reviewing`, `merging`)
  and still carries the job's claim token → `revertClaim()` releases it back to the status
  it was claimed from (the last history entry's `pre_status` when valid, otherwise
  planning→`plan_requested`, coding→`ready_for_code`, reviewing→`code_review_requested`,
  merging→`approved`), records history, adds a **system** conversation entry with the
  exit code and the last 30 lines of output, and logs a `task_reverted` activity event.
  The job is `reverted`. After `AGENTQ_MAX_REVERTS` (3) runs in a row that ended without a
  submit, the task goes to `needs_human` instead, with a blocker quoting the last output,
  and the job is `blocked`: a broken task no longer loops forever. Any submit, answer or
  unblock resets the count.

The same revert runs when a job is killed by Stop, by server shutdown, or by the job
timeout. On Windows the whole process tree is ended (`taskkill /T /F`), so the tool's MCP
servers and shell children go with it. On every platform the runner stops reading output
2 s after the tool exits, even if a leftover child still holds the pipes open. After a revert the engine backs off before claiming the same task again
(30 s, doubling per consecutive revert, capped at 30 min) so a crashing tool is not
relaunched in a tight loop; the counter resets when a job for that task succeeds.

When a person unblocks, cancels or answers a task from the portal while a job is still
working on it, the server kills that job (`abandonTask`). Its claim token is gone, so
anything the dying agent still submits is refused.

### Separation of duties and restarts

A runner claims with its id, so every claim of the same runner has the same
`sessionKey` (`runner:<id>`) across jobs. Submits record it as the producer of
the artifact, and a claim never returns the review of code the same runner
wrote. On an L1+ project a runner with both `code` and `review` therefore needs a
second runner with `review`; the Runners page says so. Reviews nobody eligible picks
up go to a person after the project's `reviewStarvationMin`.

When the server starts, tasks that a runner job held when the server went down
go back to the queue (`recoverOrphans`), before any runner claims again. The
server also sweeps every minute: expired leases of hand-opened sessions and
starved reviews (see [policy.md](policy.md)).

### Claim tokens

Each claim gets a secret `claimToken` that every `submit_*` and `report_blocker` call
must present. The runner puts it in the job's MCP launch env (`AGENTQ_TASK_ID`,
`AGENTQ_CLAIM_TOKEN`, `AGENTQ_AGENT_ID`), so the job's server attaches it on its own, and
also writes it into the prompt's submit arguments for tools that end up using another
`agentq` server. The runner claims with `runnerId`, which becomes the claim's stable
`sessionKey` (`runner:<id>`).

## Verification

The web server also runs a **built-in verifier** (no LLM; `packages/web/src/runner/verify.ts`).
When a coder submits and the project has commands (**Projects → Edit → Commands**, or
**Detect from the repository**), the task goes to `verify_requested`; the verifier claims
it, runs the commands in the task's worktree and routes it:

- **Commands**, each once and in order: `install`, then the approved plan's
  `regressionCommands` (or the project's build, typecheck, lint and test commands when
  there is no approved plan), then the command of each acceptance criterion (from the
  validation plan or the criterion's `verify.command`). Each runs with `CI=1` and the
  project's `verifyTimeoutSec` (600 s); a failing command is retried once and marked
  **flaky** when the retry passes. Logs go to `<AGENTQ_HOME>/runs/<taskId>/verify-R<n>-<i>.log`;
  the evidence keeps the last 40 lines.
- **Trust**: the project's own commands always run. Commands an agent wrote (plan items,
  criteria) run only when a person approved the plan, or when they start with an
  allowlisted prefix (common test runners plus the project's `verifyAllowlist`);
  otherwise the evidence says "skipped".
- **Tampering**: the diff against the merge branch is checked for deleted test files,
  added `.skip`/`.only`/`xit`/`@pytest.mark.skip`/`t.Skip`/`@Disabled`, and lowered
  coverage thresholds. Tampering counts as a failure; a second time goes to a person.
- **Risk**: touching `protectedPaths` or a diff larger than `maxDiffLines` raises the
  task's risk to high (an AI approval then still goes to a person).
- **Routing**: green → review (AI reviewer under L1+, a person under L0); red →
  `changes_requested` with the evidence; red `maxVerifyFailures` (2) times in a row →
  `needs_human`. A missing worktree goes to `needs_human` without counting a failure.

Without commands, or when the verifier is not running (it writes a heartbeat; MCP-only
setups have no web server), the code goes straight to review and the task notes that it
was not verified. `AGENTQ_VERIFY_WORKER=0` turns the verifier off. The Runners page shows
its status.

## Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `AGENTQ_HOME` | `~/.agentq` | Root for run artifacts (`<home>/runs/<taskId>/<jobId>.log` and `.prompt.md`) |
| `AGENTQ_JOB_TIMEOUT_MIN` | `60` | Kill a job that runs longer than this and release its task |
| `AGENTQ_MAX_REVERTS` | `3` | Consecutive runs without a submit after which the task goes to `needs_human` |
| `AGENTQ_VERIFY_WORKER` | on | `0` turns the built-in verifier off |
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

# 3. a runner on Claude Code that plans, codes and opens the PR, and one on Codex that reviews
curl -s localhost:3999/api/runners -H 'content-type: application/json' -d '{
  "name": "claude-coder", "tool": "claude", "roles": ["plan", "code", "pr"], "permissionMode": "safe", "enabled": true
}'
curl -s localhost:3999/api/runners -H 'content-type: application/json' -d '{
  "name": "codex-reviewer", "tool": "codex", "roles": ["plan_review", "review"], "permissionMode": "safe", "enabled": true
}'

# 4. create a task on the board (requires plan) and watch:
#    plan_requested → planning (runner) → waiting_plan_review → approve in the UI →
#    ready_for_code → coding (runner) → waiting_code_review → approve → merging → pr_open
#    → complete once the PR is merged on GitHub (or "Mark merged" on the task page)
```

For tests, use `tool: "custom"` with `extraArgs` such as
`["bun", "packages/web/src/runner/testing/fake-agent.ts", "submit_plan", "{\"message\":\"## Plan\"}"]`:
the fake agent starts the server from `$AGENTQ_MCP_CONFIG` and calls the tool for
`$AGENTQ_TASK_ID`, as a real coding tool would.
