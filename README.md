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
- **Plan → Code → Review → Merge** - Full workflow with approval gates and feedback loops

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

- **Task Board** - Kanban columns: Pending, In Progress, Need Review, Done
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
```

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
| **Web Server** | REST API + SSE + static UI serving (single port 3000) |
| **CLI** | Command-line interface for agents to interact with the queue |
| **Database** | Local SQLite for persistence |
| **AI Skills** | Agent instructions for consistent workflow integration |

### Project Structure

```
agent-task-queue/
├── packages/
│   ├── cli/          # CLI tool for agents
│   ├── web/          # API server + SSE
│   ├── web-ui/       # React dashboard
│   ├── shared/       # Database, types, shared logic
│   └── installer/    # Installation scripts
├── openspec/         # Specifications and change proposals
└── skills/           # AI agent skills
```

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
# Run tests
bun test

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
