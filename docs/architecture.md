# AgentQ — Feature & Component Description

A local task queue system for managing coding-agent work across multiple projects. Provides a centralized backlog that allows AI agents to pull work items, complete them, and continue from well-defined context.

> Tagline: "If you want to be a 100x engineer, stop prompting and start queueing."

---

## 1. Features

### Multi-Project Task Management
Manage tasks across multiple repositories from a single dashboard. Each task belongs to a project, which represents a local repository with its own working directory.

### Agent Orchestration
Multiple AI agents can claim, work on, and complete tasks autonomously. Agents are identified by tool name, version, model, role, and session — enabling full audit traceability.

### Plan → Code → Review → Merge Workflow
Full lifecycle with approval gates and feedback loops. Tasks flow through planning, coding, reviewing, and merging phases. At each gate, a user or an agent can approve, request changes, or trigger an AI review.

### Role-Based Access
Five roles with distinct permissions:
- **Planner** — Creates implementation plans
- **Implementer** — Writes code
- **Reviewer** — Reviews submissions
- **Senior** — All roles combined
- **Architect** — Planning + reviewing (no implementation)

### Real-Time Updates
SSE-powered live updates propagate changes across web UI and CLI instantly. Task creation and status changes appear without manual refresh.

### Web Dashboard
Kanban-style board with four columns (Pending, In Progress, Need Review, Done), task detail drawer, agent monitoring, activity feed, project management, and install tools.

### CLI for Agents
Standalone binary (`agentq`) that operates directly on the local database — no running server required. Supports listing, creating, claiming, and submitting tasks with structured JSON output for machine consumption.

### AI Skills
Pre-built agent skill files that guide coding agents on how to use the CLI and interact with the system consistently. Includes workflow protocol, phase intelligence, worktree management, and guardrails.

### Feedback Loops
Both planning and coding phases support iteration: plans can be revised, code can be reworked after review, and stuck tasks can be unblocked.

### On-Demand AI Reviews
Users can request an automated AI code review from the web UI, which opens the task for a reviewer agent to claim and evaluate.

### Soft Delete
Tasks, projects, and agents support soft deletion with restore capability. Hard deletion available via explicit flag.

### Git Worktree Isolation
Code changes are isolated in git worktrees — one per task — avoiding cross-task interference during parallel development.

---

## 2. Core Components

### Web Portal
React SPA dashboard for human supervision. Features:
- **Kanban board** — 4 columns (Pending, In Progress, Need Review, Done) with color-coded headers
- **Search & filters** — Search by title/branch, filter by status, agent, project
- **Task creation modal** — Full form with description, steer details, guardrails, acceptance criteria, priority, branch, project assignment, and plan requirement toggle
- **Task detail page** — Full task view with metadata grid, markdown description, steer details, guardrails, acceptance criteria checklist, action buttons (approve/request changes/cancel/unblock/request AI review/confirm completion), conversation thread, and status history timeline
- **Agents view** — Table with agent ID, tool, model, role, last seen, session; filterable by role and tool
- **Activity feed** — Global timeline of all task lifecycle events with filters for task, agent, and date range
- **Projects management** — CRUD for projects
- **Tools page** — Install cards for binary, skills, and agent setup
- **Real-time updates** — SSE connection for live board refresh
- **Light/dark theme** — Persistent via localStorage

### Web Server
Pure Bun HTTP server serving on a single port. Responsibilities:
- REST API for all CRUD and workflow operations on tasks, projects, agents, and activity
- Server-Sent Events endpoint for real-time streaming to connected clients
- Static file serving for the pre-built web UI
- Request validation via Zod schemas
- Automatic Vite dev server management in development mode
- CORS support for development

### CLI
Standalone binary (`agentq`) built with Commander for agent-to-system interaction. Capabilities:
- **List** all tasks with project info
- **Get** a single task by ID
- **Create** tasks with full metadata (description, priority, branch, acceptance criteria, guardrails, steer details, plan requirement)
- **Claim** the highest-priority eligible task for a given agent role (planner, implementer, reviewer, senior, architect)
- **Submit plan** — transitions task from Planning to Waiting Plan Review
- **Submit code** — transitions from Coding to Waiting Code Review, stores worktree path
- **Submit review** — transitions from Reviewing back to Waiting Code Review
- **Submit merge** — transitions from Merging to Merged with branch, commit, and author info
- **JSON output** — all commands support `--json` for structured machine-readable output
- **Direct database access** — no server dependency

### Database
Local SQLite database storing all system data:
- Tasks with full metadata, context, and workflow state
- Projects representing repositories
- Agents with session tracking
- Activity events for audit trail
- Normalized conversation entries and status history
- Migration system for schema evolution

### AI Skills
Agent instruction files that define the exact protocol for interacting with AgentQ:
- **agentq-workflow** — Full protocol: claim → work → submit → repeat. Includes identity info, CLI command reference, phase intelligence table, working directory rules, worktree management, git safety rules, message format templates, autonomy guidelines, and strict guardrails
- **agentq-create-task** — Instructions for creating well-structured tasks via the CLI with project discovery, task elaboration, and acceptance criteria generation
- Agent skills are installed to multiple AI tool configs (opencode, claude, codex, kimi, junie) via a single install command

### Installer
Scripts for one-click setup:
- **Binary installer** — Compiles the CLI into a standalone binary and copies it to `~/.local/bin`
- **Skills installer** — Copies the workflow skill to all supported agent config directories
- **Agent installer** — Copies subagent definitions (e.g., task fetcher) to the opencode agents directory

---

## 3. Domain Entities

### Task
A unit of work assigned to an agent. Contains:
- **Identity**: UUID, title, description
- **Guidance**: steerDetails (technical recommendations), guardrails (behavioral constraints), acceptanceCriteria (completion conditions)
- **Priority**: Numeric value, higher = more urgent
- **Branching**: recommendedBranch, realBranch, mergeBranch (default: develop), worktreePath
- **Workflow**: requiresPlan flag (immutable), status (15 lifecycle states), assignedAgent reference
- **History**: chronological conversation thread, status transition history, agent context snippets
- **Timestamps**: created_at, updated_at, deleted_at (soft delete)
- **Project**: belongs to one project via projectId

### Agent
A coding agent that claims and works on tasks. Contains:
- **Identity**: auto-generated ID (`tool@version|model`), toolName, version, model
- **Role**: planner, implementer, reviewer, senior, or architect
- **Session**: sessionId (UUID), host, started_at, last_seen
- **Lifecycle**: soft delete support

### Project
A local repository that tasks belong to. Contains:
- **Identity**: UUID, displayName
- **Location**: workingDirectory (absolute path to repo)
- **Lifecycle**: timestamps, soft delete support

### ActivityEvent
An audit log entry recording system events. Contains:
- eventType (e.g., task_created, plan_submitted, code_approved)
- taskId, actor, details, timestamp

### ConversationEntry
A message in a task's conversation thread. Contains:
- authorName (format: `"agentName|tool|model"` for agents, `"user"` for humans)
- timestamp, message body, messageType (user/agent/plan/code/review/merge/system)

### StatusHistoryEntry
A record of a task status transition. Contains:
- pre_status, new_status, timestamp

---

## 4. Task Workflow

### States (15 total)

The task lifecycle moves through these states:

**plan_requested** (New) → Initial state when task requires planning. Pending agent assignment.

**planning** → Agent is actively developing an implementation plan.

**waiting_plan_review** → Plan submitted, awaiting user review.

**plan_changes_requested** → Reviewer requested plan modifications. Feedback loop back to planning.

**ready_for_code** → Initial state when task does not require planning, or plan was approved. Ready for implementation.

**coding** → Agent is actively implementing the task.

**waiting_code_review** → Code submitted, awaiting review. Can trigger an on-demand AI review.

**code_review_requested** → User explicitly requested an AI code review. Pending reviewer assignment.

**reviewing** → Agent is actively reviewing the submitted code.

**changes_requested** → Reviewer identified issues. Feedback loop back to coding.

**approved** → Code accepted. Ready for merge.

**merging** → Agent is merging code into target branch.

**merged** → Code merged. Awaits final confirmation.

**complete** → All work finished. Terminal state.

**canceled** → Work stopped. Can be entered from any state.

### User Actions
- Approve plan, request plan changes
- Approve code, request code changes
- Request AI review
- Cancel task, unblock stuck task
- Confirm completion

### Agent Actions
- Claim task (based on role eligibility)
- Submit plan, submit code, submit review, submit merge

---

## 5. Board Column Mapping

| Board Column | Task States Shown |
|---|---|
| **Pending** | plan_requested, ready_for_code, plan_changes_requested, code_review_requested, changes_requested, approved |
| **In Progress** | planning, coding, reviewing, merging |
| **Need Review** | waiting_plan_review, waiting_code_review |
| **Done** | complete, merged |
