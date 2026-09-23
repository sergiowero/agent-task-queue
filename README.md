# AgentQ

> If you want to be a 100x engineer, stop prompting and start queueing.

AgentQ is a local task queue system for managing coding-agent work across multiple projects. It provides a centralized backlog that allows AI agents (OpenCode, Codex, Claude, and others) to pull work items, complete them, and continue from well-defined context.

## Features

- **Multi-project task management** - Manage tasks across multiple repositories from a single dashboard
- **Agent orchestration** - Let multiple AI agents claim, work on, and complete tasks autonomously
- **Real-time updates** - SSE-powered live updates across web UI and CLI
- **Role-based workflows** - Planner, implementer, reviewer, and senior roles with proper access control
- **Web dashboard** - Kanban-style board with task details, agent monitoring, and activity feed
- **CLI for agents** - Structured commands for agents to interact with the queue
- **Runners** - Launch Claude Code, Codex, OpenCode or Gemini headless on claimed tasks, no manual prompting
- **Plan → Code → Review → Merge** - Full workflow with approval gates and feedback loops
- **Archive** - Save complete tasks in the project's `archive/` folder as Markdown (a summary and a full record), from the board or with the `agentq-archive` skill

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime
- Git

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd agent-task-queue

# Install dependencies
bun install
```

### Running the System

```bash
# Production mode (builds UI + starts server on single port)
bun run start

# Development mode (with Vite HMR on a single port)
bun run dev
```

Open `http://localhost:3000` for both the API and the web UI (single port).

## Usage

### Web Dashboard

The web interface provides:

- **Task Board** - Kanban columns: Pending, In Progress, Need Review, Done. Complete cards have an **Archive** button
- **Task Details** - Full task info, conversation thread, and history
- **Agents View** - Monitor active agents and their current tasks
- **Activity Feed** - Real-time event stream of all task lifecycle events

### CLI for Agents

Agents interact with AgentQ using the CLI:

```bash
# Claim the next available task
agentq claim \
  -n <agent-name> \
  -v <version> \
  -m <model> \
  -r <role> \
  -s <session-id> \
  --json

# Submit a plan
agentq submit-plan <task-id> --json -m "## Plan\n1. Step one\n2. Step two"

# Submit code
agentq submit-code <task-id> --json -m "## Changes\n- Modified file.ts" --worktree /tmp/agentq-<task-id>

# Submit review
agentq submit-review <task-id> --json -m "## Review\n- Looks good"

# Submit merge
agentq submit-merge <task-id> --json -b <branch> -c <commit> --authors <authors>

# Archive a complete task into {project}/archive/ (what the board's Archive button does)
agentq list --status complete --json
agentq archive <task-id> --json [--pr <url>] [--summary "<markdown overview>"]
```

### Archive

Archiving a task in `complete` status writes two Markdown files to `{project.workingDirectory}/archive/`
and takes the task off the board (`agentq get` and the task page still show it):

| File | Content |
|------|---------|
| `<date>-<id8>-<slug>.summary.md` | Key facts (branch, merge target, PR, commit, authors, agents, dates), the description, acceptance criteria, what was done (latest plan, implementation, review and merge messages), agent sessions and the status path |
| `<date>-<id8>-<slug>.detailed.md` | Everything: every field, steer details, guardrails, context notes, each agent and claim, the full status history, every conversation message, the activity log and the raw task JSON |

Use the **Archive** button on a complete card (or on the task page), `agentq archive`, the MCP
`archive_task` tool, or the `agentq-archive` skill. The skill also finds the PR with `gh` when the
conversation does not mention it and writes an overview of what was done. The files are left
uncommitted.

### Runners

Runners take the "open the coding tool by hand" step out of the loop. A runner is a
server-side worker with a role (planner, implementer, reviewer, senior, architect), an
optional project and a tool. Every few seconds it claims the next eligible task and
launches the tool headless in the project directory with the task and the phase skill as
the prompt; the tool finishes with the normal `agentq submit-*` command.

- Manage runners on the **Runners** page (or `/api/runners`): create, edit, start/stop,
  delete, and follow each job's live output.
- Supported tools: `claude`, `codex`, `opencode`, `gemini`, and `custom` (your own argv).
- `safe` mode allows edits plus a fixed command allow-list; `full` mode skips all
  permission prompts and sandboxes.
- If the tool exits without submitting, the runner releases the task back to the queue
  with a system note containing the last lines of output.

See [docs/runner.md](docs/runner.md) for commands, permission modes, environment
variables and a demo script.

### Agent Workflow

```
1. Claim task        → Agent picks up work
2. Read task context → Understand requirements
3. Work on task      → Plan, code, or review
4. Submit work       → Update task status
5. Repeat            → Pick next task
```

## Architecture

AgentQ consists of five core components:

| Component | Description |
|-----------|-------------|
| **Web Portal** | React-based dashboard with Kanban board, task details, and monitoring |
| **Web Server** | REST API + SSE + runners + static UI serving (single port 3000) |
| **CLI** | Command-line interface for agents to interact with the queue |
| **Database** | Local SQLite for persistence |
| **AI Skills** | Agent instructions for consistent workflow integration |

### Project Structure

```
agent-task-queue/
├── packages/
│   ├── cli/          # CLI tool for agents (agentq claim / submit-*)
│   ├── mcp/          # MCP server exposing the same protocol as typed tools
│   ├── web/          # API server + SSE + runner engine (packages/web/src/runner)
│   ├── web-ui/       # React dashboard
│   ├── shared/       # Database, types, workflow rules (single source of truth)
│   └── installer/    # Binary + skills + agents installers
├── docs/             # architecture.md, runner.md, mcp.md, project-spec.md
└── skills/           # Agent skills: agentq-claim (router) + agentq-plan/code/review/merge + agentq-create-task + agentq-archive
```

### Ways an agent can talk to AgentQ

| Channel | When to use |
|---------|-------------|
| **Runner** (web UI → Runners) | Hands-free: the server claims tasks and launches `claude` / `codex` / `opencode` / `gemini` headless in the project directory. See `docs/runner.md`. |
| **CLI + skills** | You open the coding tool yourself and invoke the `agentq-claim` skill; it claims and routes to the phase skill. Install with `bun run install:bin` and `bun run install:skills`. |
| **MCP server** | Same operations as typed tools for any MCP-capable client. See `docs/mcp.md`. |

All three share the same SQLite database and the same workflow code in `packages/shared`.

## Workflow

### Task States

```
New → Planning → Waiting Plan Review → Ready for Code
                                           ↓
                                       Coding
                                           ↓
                                   Waiting Code Review
                                      ↓         ↓
                          Code Review    Approved
                             ↓              ↓
                          Reviewing      Merging
                             ↓              ↓
                      Waiting Code      Merged
                        Review            ↓
                                      Complete
```

### Roles

| Role | Responsibilities |
|------|------------------|
| **Planner** | Create implementation plans for tasks requiring planning |
| **Implementer** | Code and implement tasks |
| **Reviewer** | Review submitted code and provide feedback |
| **Senior** | All of the above (planner + implementer + reviewer) |
| **Architect** | Planning + reviewing (no implementation) |

### User Actions

- **Approve plan** - Move task from Waiting Plan Review → Ready for Code
- **Request plan changes** - Move task back to Planning
- **Approve code** - Move task to Approved
- **Request code changes** - Move task back to Coding
- **Request AI review** - Trigger automated code review
- **Cancel task** - Stop work on task (any active state)
- **Confirm completion** - Mark merged task as Complete
- **Archive** - Save a complete task to `{project}/archive/` as Markdown and take it off the board

## Configuration

### Agent ID Format

Agent IDs follow the pattern: `<tool>@<version>|<model>`

Example: `opencode@1.0|big-pickle`

### Role-to-Status Mapping

| Role | Can Claim Tasks In |
|------|-------------------|
| planner | New, Plan Changes Requested |
| implementer | Ready for Code, Changes Requested, Approved |
| reviewer | Code Review Requested |
| senior | All states |
| architect | New, Plan Changes Requested, Code Review Requested |

## Development

```bash
# Run tests (never touches ~/agentq/agentq.db — tests use in-memory / temp databases)
bun test

# Typecheck every package
bun run typecheck

# Run specific package
bun run --cwd packages/cli src/index.ts
```

## Contributing

1. Create a feature branch from `develop`
2. Make your changes
3. Submit a pull request
4. Wait for review approval

## License

[Add your license here]
