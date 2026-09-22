# Runners

A **runner** is the piece of AgentQ that removes the "open Claude / Codex / OpenCode by
hand" step. It lives inside the web server, polls the queue with a role, and every time
it claims a task it launches the configured coding tool **headless** in the project's
working directory with a prompt that contains the task and the matching phase skill.
The tool does the work and finishes with the usual `agentq submit-*` command; the runner
only watches the process.

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

The runner writes the prompt to `~/agentq/runs/<taskId>/<jobId>.prompt.md` and runs:

| Tool | Command |
|------|---------|
| `claude` | `claude -p <prompt> --output-format json` + permission flags + `--model <m>` + extra args |
| `codex` | `codex exec --full-auto -C <cwd> --skip-git-repo-check [-m model] <extra args> <prompt>` |
| `opencode` | `opencode run --dir <cwd> --format json --auto [-m provider/model] <extra args> <prompt>` |
| `gemini` | `gemini -p <prompt> --yolo [-m model] <extra args>` |
| `custom` | `extraArgs` **is** the argv; the prompt is appended as the last argument and exposed as `$AGENTQ_PROMPT` |

Every child gets `AGENTQ_TASK_ID`, `AGENTQ_ROLE` and `AGENTQ_PROMPT_FILE` in its
environment. `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` are removed so a runner started
from inside a Claude Code session does not trip the nested-session guard. The working
directory is the project's `workingDirectory` (with `~` expanded); if it does not exist
the task is released immediately and the job is marked reverted.

### Permission modes

- **safe** (default) — the tool may edit files and run a fixed allow-list of commands.
  For Claude Code: `--permission-mode acceptEdits --allowedTools "Bash(agentq:*)"
  "Bash(git:*)" "Bash(gh:*)" "Bash(bun:*)" "Bash(npm:*)" "Bash(npx:*)" "Bash(ls:*)"
  "Bash(cat:*)" "Bash(grep:*)" "Bash(find:*)" Edit Write Read Glob Grep`. Codex runs
  with `--full-auto` (sandboxed workspace-write).
- **full** — no prompts, no sandbox: Claude gets `--dangerously-skip-permissions`, Codex
  `--dangerously-bypass-approvals-and-sandbox`. Use only for repositories you trust the
  agent to operate in unattended.

### The prompt

`buildPrompt()` tells the tool it is an AgentQ `<role>` agent, that task `<id>` was
**already claimed for it** (so it must not run `agentq claim`), the current status, the
full task JSON (title, description, steerDetails, guardrails, acceptanceCriteria,
conversation, contexts, branches, worktreePath, project working directory), the body of
`skills/agentq-<phase>/SKILL.md` (frontmatter stripped) inline, the exact submit
command to finish with, never to ask for permission, and to stop after submitting.

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
timeout. After a revert the engine backs off before claiming the same task again
(30 s, doubling per consecutive revert, capped at 30 min) so a crashing tool is not
relaunched in a tight loop; the counter resets when a job for that task succeeds.

## Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `AGENTQ_HOME` | `~/agentq` | Root for run artifacts (`<home>/runs/<taskId>/<jobId>.log` and `.prompt.md`) |
| `AGENTQ_JOB_TIMEOUT_MIN` | `60` | Kill a job that runs longer than this and release its task |
| `AGENTQ_DB_PATH` | `~/agentq/agentq.db` | Database (shared with the CLI the tool calls) |

## Live updates

SSE (`/api/events`) carries, in addition to `task_created` / `task_updated`:

- `runner_updated` — a runner's live state (`{ id, running, activeJobs, lastError, lastJob, jobCount }`)
- `runner_job` — `{ type: "started" | "finished", runnerId, jobId, job }` and
  `{ type: "output", runnerId, jobId, taskId, chunk }` (output is batched, at most ~10/s per job)
- `runner_deleted` — `{ id }`

Because the CLI writes straight to SQLite, the server also watches `tasks.updated_at`
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
`["bash", "-c", "agentq submit-plan \"$AGENTQ_TASK_ID\" --json -m '## Plan'"]`.
