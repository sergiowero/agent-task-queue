# AgentQ

> If you want to be a 100x engineer, stop prompting and start queueing.

AgentQ is a local task queue system for managing coding-agent work across multiple projects. It provides a centralized backlog that allows AI agents (OpenCode, Codex, Claude, and others) to pull work items, complete them, and continue from well-defined context.

## Features

- **Multi-project task management** - Manage tasks across multiple repositories from a single dashboard
- **Agent orchestration** - Let multiple AI agents claim, work on, and complete tasks autonomously
- **Real-time updates** - SSE-powered live updates on the web UI as agents claim and submit
- **Role-based workflows** - Planner, implementer, reviewer, and senior roles with proper access control
- **Web dashboard** - Kanban-style board with task details, agent monitoring, and activity feed
- **MCP server for agents** - Typed tools (claim, submit, get, create, archive...) for Claude Code, Codex, OpenCode, Gemini CLI and any other MCP client
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

# Connect your coding tools to AgentQ: MCP server + workflow skills
bun run install:all
```

`install:all` runs `install:mcp` (registers the AgentQ MCP server with every coding tool installed
on the machine: Claude Code, Codex, OpenCode, Gemini CLI on macOS, Linux and Windows) and
`install:skills`. It is safe to run again. Runners do not need it: each runner job gets the
server automatically.

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

### Agents (MCP)

Agents work the queue through the tools of the `agentq` MCP server (in Claude Code they are
named `mcp__agentq__<tool>`). Humans use the portal; agents use MCP.

| Tool | What an agent does with it |
|------|----------------------------|
| `claim_task` | Claim the next task for its role (`toolName`, `version`, `model`, `role`, `sessionId`, optional `projectId` and `context`) |
| `submit_plan` / `submit_code` / `submit_review` / `submit_merge` | Finish a phase with a Markdown `message` and a required `context` (handoff notes for the next agent) (`submit_code` also takes the `worktree`, `submit_merge` the `mergeBranch`, `commit` and `authors`) |
| `get_task`, `post_comment` | Re-read or annotate the claimed task |
| `list_projects`, `create_task` | Create well-formed tasks (the `agentq-create-task` skill) |
| `list_tasks`, `archive_task` | Archive complete tasks (the `agentq-archive` skill) |

Invoke the `agentq-claim` skill in your coding tool (for example "work the AgentQ queue as a
senior") and it claims, routes to the phase skill and submits until no tasks are left. See
[docs/mcp.md](docs/mcp.md) for every tool, its inputs and the setup details.

### Archive

Archiving a task in `complete` status writes two Markdown files to `{project.workingDirectory}/archive/`
and takes the task off the board (the task page and `get_task` still show it):

| File | Content |
|------|---------|
| `<date>-<id8>-<slug>.summary.md` | Key facts (branch, merge target, PR, commit, authors, agents, dates), the description, acceptance criteria, what was done (latest plan, implementation, review and merge messages), agent sessions and the status path |
| `<date>-<id8>-<slug>.detailed.md` | Everything: every field, steer details, guardrails, context notes, each agent and claim, the full status history, every conversation message, the activity log and the raw task JSON |

Use the **Archive** button on a complete card (or on the task page), the MCP `archive_task` tool,
or the `agentq-archive` skill. The skill also finds the PR with `gh` when the
conversation does not mention it and writes an overview of what was done. The files are left
uncommitted.

### Runners

Runners take the "open the coding tool by hand" step out of the loop. A runner is a
server-side worker with a role (planner, implementer, reviewer, senior, architect), an
optional project and a tool. Every few seconds it claims the next eligible task and
launches the tool headless in the project directory with the task and the phase skill as
the prompt. Each job gets the AgentQ MCP server, bound to the server's database, and the tool
finishes by calling the phase's `submit_*` tool.

- Manage runners on the **Runners** page (or `/api/runners`): create, edit, start/stop,
  delete, and follow each job's live output.
- Supported tools: `claude`, `codex`, `opencode`, `gemini`, and `custom` (your own argv).
- `safe` mode allows edits, a fixed command allow-list and the AgentQ tools a claimed job
  needs; `full` mode skips all permission prompts and sandboxes.
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
| **MCP Server** | The agents' channel: claim, submit, read and create tasks as typed tools |
| **Database** | Local SQLite for persistence |
| **AI Skills** | Agent instructions for consistent workflow integration |

### Project Structure

```
agent-task-queue/
├── packages/
│   ├── mcp/          # MCP server: the agent protocol as typed tools (claim_task, submit_*...)
│   ├── web/          # API server + SSE + runner engine (packages/web/src/runner)
│   ├── web-ui/       # React dashboard
│   ├── shared/       # Database, types, workflow rules (single source of truth)
│   └── installer/    # MCP setup (install:mcp) + skills installers
├── docs/             # architecture.md, runner.md, mcp.md, project-spec.md
└── skills/           # Agent skills: agentq-claim (router) + agentq-plan/code/review/merge + agentq-create-task + agentq-archive
```

### Ways an agent can talk to AgentQ

| Channel | When to use |
|---------|-------------|
| **Runner** (web UI → Runners) | Hands-free: the server claims tasks and launches `claude` / `codex` / `opencode` / `gemini` headless in the project directory. See `docs/runner.md`. |
| **MCP + skills** | You open the coding tool yourself and invoke the `agentq-claim` skill; it claims through the MCP tools and routes to the phase skill. Set up once with `bun run install:mcp` and `bun run install:skills`. See `docs/mcp.md`. |

Both go through the AgentQ MCP server, over the same SQLite database and the same workflow code in `packages/shared`.

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

# Run the MCP server on stdio (what coding tools start)
bun run mcp
```

## Contributing

1. Create a feature branch from `develop`
2. Make your changes
3. Submit a pull request
4. Wait for review approval

## License

[Add your license here]
