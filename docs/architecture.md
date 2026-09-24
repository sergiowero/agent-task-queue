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
SSE-powered live updates propagate changes to the web UI instantly, including the claims and submissions agents make through the MCP server. Task creation and status changes appear without manual refresh.

### Web Dashboard
Kanban-style board with four columns (Pending, In Progress, Needs you, Done), task detail drawer, agent monitoring, activity feed, project management, and install tools.

### MCP Server for Agents
Stdio MCP server (`packages/mcp`) that operates directly on the local database — no running server required. It is the only agent channel: claiming, submitting, reading, listing, creating and archiving tasks are typed tools with JSON results. `bun run install:mcp` registers it with every installed coding tool, and runner jobs get it automatically.

### AI Skills
Pre-built agent skill files that guide coding agents on how to use the AgentQ MCP tools and interact with the system consistently. Includes workflow protocol, phase intelligence, worktree management, and guardrails.

### Feedback Loops
Both planning and coding phases support iteration: plans can be revised, code can be reworked after review, and stuck tasks can be unblocked.

### On-Demand AI Reviews
Users can request an automated AI code review from the web UI, which opens the task for a reviewer agent to claim and evaluate.

### Task Archive
Complete tasks can be archived from the board (**Archive** button on complete cards and on the task page), the MCP server (`archive_task`) or the `agentq-archive` skill. Archiving writes two Markdown files to `{project.workingDirectory}/archive/`: `<date>-<id8>-<slug>.summary.md` (key facts, description, what was done, agents) and `<date>-<id8>-<slug>.detailed.md` (every field, message, status change, agent session and activity event, plus the raw task JSON). The pull request is read from the conversation, or passed explicitly. The task then gets `archivedAt` / `archivePath` and leaves the board and `list_tasks`. The logic lives in `packages/shared/src/archive.ts`.

### Soft Delete
Tasks, projects, and agents support soft deletion with restore capability. Hard deletion available via explicit flag.

### Git Worktree Isolation
Code changes are isolated in git worktrees — one per task — avoiding cross-task interference during parallel development.

---

## 2. Core Components

### Web Portal
React SPA dashboard for human supervision. Features:
- **Kanban board** — 4 columns (Pending, In Progress, Needs you, Done) with color-coded headers; complete cards have an **Archive** button
- **Search & filters** — Search by title/branch, filter by status, agent, project
- **Task creation modal** — Full form with description, steer details, guardrails, acceptance criteria, priority, branch, project assignment, and plan requirement toggle
- **Task detail page** — Full task view with metadata grid, markdown description, steer details, guardrails, acceptance criteria checklist, action buttons (approve/request changes/cancel/unblock/request AI review/confirm completion), the blocker panel for `needs_human` tasks (the agent's question, an answer box and where to send the task), conversation thread, and status history timeline
- **Agents view** — Table with agent ID, tool, model, role, last seen, session; filterable by role and tool
- **Activity feed** — Global timeline of all task lifecycle events with filters for task, agent, and date range
- **Projects management** — CRUD for projects
- **Tools page** — Install steps for the MCP server and the skills
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

### MCP Server
Stdio [MCP](https://modelcontextprotocol.io) server (`packages/mcp`) for agent-to-system interaction; see `docs/mcp.md`. Tools:
- **claim_task** — claims the highest-priority eligible task for a given agent role (planner, implementer, reviewer, senior, architect)
- **submit_plan** — transitions task from Planning to Waiting Plan Review
- **submit_code** — transitions from Coding to Waiting Code Review, stores worktree path
- **submit_review** — transitions from Reviewing back to Waiting Code Review
- **submit_merge** — transitions from Merging to Merged with branch, commit, and author info
- **get_task** / **post_comment** — read a task, or add a note without changing its status
- **list_tasks** — tasks with project info, filtered by status and project (archived tasks left out)
- **list_projects** / **create_task** — create tasks with full metadata (description, priority, branch, acceptance criteria, guardrails, steer details, plan requirement)
- **archive_task** — writes a complete task's summary and detailed record to `{project}/archive/` and takes it off the board (`pullRequests`, `overview`, `force`, `directory`)
- **JSON results** — every tool returns `{ success, ... }` as text and structured content
- **Direct database access** — no server dependency; `AGENTQ_DB_PATH` comes from the tool's MCP config

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
- **agentq-claim** — Full protocol: claim → work → submit → repeat. Includes identity info, MCP tool reference, phase intelligence table, working directory rules, worktree management, git safety rules, message format templates, autonomy guidelines, and strict guardrails
- **agentq-create-task** — Instructions for creating well-structured tasks through the MCP tools with project discovery, task elaboration, and acceptance criteria generation
- **agentq-archive** — Archives complete tasks with the `archive_task` MCP tool (same as the board's Archive button), finds the PR with `gh` when the conversation lacks it, and writes an overview of what was done
- Agent skills are installed to multiple AI tool configs (opencode, claude, codex, kimi, junie) via a single install command

### Installer
Scripts for one-click setup:
- **MCP setup** — `bun run install:mcp` registers the AgentQ MCP server with every installed coding tool (Claude Code, Codex, OpenCode, Gemini CLI, GitHub Copilot CLI, GitHub Copilot in VS Code) on macOS, Linux and Windows; safe to run again
- **Skills installer** — Syncs the `agentq-*` skills into every supported agent config directory: copies the repo's skills and removes `agentq-*` folders the repo no longer ships

---

## 3. Domain Entities

### Task
A unit of work assigned to an agent. Contains:
- **Identity**: UUID, title, description
- **Guidance**: steerDetails (technical recommendations), guardrails (behavioral constraints), acceptanceCriteria (objects: id `ACn`, text, how it is verified, status, evidence ids)
- **Scope**: type (with a description template and agent guidance per type), nonGoals, references, dorIssues (Definition-of-Ready problems found at creation or edit; projects choose warn, enforce or off)
- **Handoffs**: structured notes between phases in `task_handoffs` (phase, round, agent, summary, decisions, risks, next); `contexts` keeps the plain summaries
- **Evidence**: validationPlan, approvedPlan (frozen at approval), headSha, diffStats, verification, riskReasons; evidence rows live in `task_evidence`
- **Priority**: Numeric value, higher = more urgent
- **Branching**: recommendedBranch, realBranch, mergeBranch (default: the project's defaultMergeBranch), worktreePath
- **Autonomy and review**: type (feature/bug/refactor/docs/chore), risk (low/medium/high), autonomy override, planRound, codeRound, verifyFailures, roundBaseline, producers (who produced each phase's artifact), lastReview, leaseExpiresAt; review findings live in `task_findings` (ids like `R2-3`). See [policy.md](policy.md)
- **Workflow**: requiresPlan flag (immutable), status (16 lifecycle states), assignedAgent reference (tool, model, agentId, sessionKey, runnerId), claimToken (secret of the current claim), blocker (set in `needs_human`), revertStreak
- **History**: chronological conversation thread, status transition history, agent context snippets
- **Timestamps**: created_at, updated_at, deleted_at (soft delete)
- **Archive**: archivedAt, archivePath (the summary file; the detailed record sits next to it)
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
- **Profile**: commands (install/build/test/lint/typecheck), convention files, protected paths, shared guardrails, max diff size, verifier timeout and allowlist
- **Autonomy**: level L0–L3 (default L2) and policy overrides (review rounds, spot checks, different reviewer model, lease, starvation); see [policy.md](policy.md)
- **defaultMergeBranch**: branch new tasks target unless they name one; detected from `origin/HEAD` when the project is created (falls back to `main`/`master`), editable
- **Lifecycle**: timestamps, soft delete support

### ActivityEvent
An audit log entry recording system events. Contains:
- eventType (e.g., task_created, plan_submitted, code_approved)
- taskId, actor, details, timestamp

### ConversationEntry
A message in a task's conversation thread. Contains:
- authorName (format: `"agentName|tool|model"` for agents, `"user"` for humans)
- timestamp, message body, messageType (user/agent/plan/code/review/merge/system)

### TaskBrief
What an agent reads to continue a task (`packages/shared/src/brief.ts`, MCP `get_task_brief`, the runner prompt): approved plan and validation, criteria, open findings, the latest handoff per phase, project commands, conventions and guardrails, round, and what people said since the last submission.

### StatusHistoryEntry
A record of a task status transition. Contains:
- pre_status, new_status, timestamp, actor (`user`, an agent id, `runner` or `system`)

---

## 4. Task Workflow

### States (18 total)

The state machine lives in one place: `packages/shared/src/catalog.ts` (statuses, what each means, claim rules, allowed edges) and `packages/shared/src/workflow.ts` (`transitionTask`, the only function that changes a status). The MCP server, the web API and the runner all call the workflow; `PUT /api/tasks/:id` cannot change status, history, conversation, contexts or the assignee. The web UI reads the same catalog (`@agentq/shared/catalog`).

The task lifecycle moves through these states:

**plan_requested** (New) → Initial state when task requires planning. Pending agent assignment.

**planning** → Agent is actively developing an implementation plan.

**waiting_plan_review** → Plan submitted, awaiting user review.

**plan_changes_requested** → Reviewer requested plan modifications. Feedback loop back to planning.

**ready_for_code** → Initial state when task does not require planning, or plan was approved. Ready for implementation.

**coding** → Agent is actively implementing the task.

**waiting_code_review** → Code waiting for a person: under L0 after every submit; under L1+ only when an AI approval is high risk or sampled, or no reviewer picked it up. Can trigger an on-demand AI review.

**code_review_requested** → Waiting for an AI reviewer: under L1+ right after `submit_code`, under L0 when a person requests it. Never claimed by the session that wrote the code.

**reviewing** → Agent is actively reviewing the submitted code.

**changes_requested** → A person or the AI reviewer (L1+) asked for changes; the findings are tracked by id. Feedback loop back to coding.

**approved** → Code accepted by a person, or by the AI reviewer under L1+. Ready for merge.

**merging** → Agent is merging code into target branch.

**merged** → Code merged. Awaits final confirmation.

**complete** → All work finished. Terminal state.

**canceled** → Work stopped. Can be entered from any state.

**verify_requested** → Code submitted to a project with commands; waiting for the built-in verifier.

**verifying** → The verifier is running the project's commands in the task's worktree.

**needs_human** → An agent called `report_blocker` (push rejected, missing credentials, contradictory task), or a runner job ended three times in a row without submitting (`AGENTQ_MAX_REVERTS`). The task stores a `blocker` (reason, question, phase) and nothing claims it until a person answers and picks where it goes next.

### User Actions
- Approve plan, request plan changes
- Approve code, request code changes
- Request AI review
- Cancel task, unblock stuck task (planning, coding, reviewing or merging; the runner job still working on it is stopped)
- Answer a blocked task (`resolve_blocker`): the answer goes to the conversation and the task moves to a status allowed for the phase it was blocked in
- Confirm completion
- Archive a complete task

### Agent Actions
- Claim task (based on role eligibility); the claim returns a `claimToken` every submit must present
- Submit plan, submit code, submit review, submit merge
- Report a blocker (`report_blocker`) instead of submitting partial work

---

## 5. Board Column Mapping

| Board Column | Task States Shown |
|---|---|
| **Pending** | plan_requested, ready_for_code, plan_changes_requested, code_review_requested, changes_requested, approved |
| **In Progress** | planning, coding, reviewing, merging |
| **Needs you** | waiting_plan_review, waiting_code_review, needs_human |
| **Done** | complete, merged |

Archived tasks are not shown on the board.
