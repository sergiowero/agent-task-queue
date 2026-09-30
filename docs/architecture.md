# AgentQ — Feature & Component Description

A local task queue system for managing coding-agent work across multiple projects. Provides a centralized backlog that allows AI agents to pull work items, complete them, and continue from well-defined context.

> Tagline: "If you want to be a 100x engineer, stop prompting and start queueing."

---

## 1. Features

### Multi-Project Task Management
Manage tasks across multiple repositories from a single dashboard. Each task belongs to a project, which represents a local repository with its own working directory.

### Agent Orchestration
Multiple AI agents can claim, work on, and complete tasks autonomously. Agents are identified by tool name, version, model and session, and each claim records the role it acts as — enabling full audit traceability.

### Plan → Code → Review → Pull Request Workflow
Full lifecycle with feedback loops. Tasks flow through refinement, planning (with an AI critique of the plan), coding, verification, code review and the pull request, and end when the pull request is merged on GitHub. Each project's autonomy level decides who makes each gate: a person, or an AI critic and an AI reviewer that stop with a concrete question when a limit is hit. At every gate a change request goes back with findings tracked by id. See [policy.md](policy.md).

### Autonomy Levels
Each project runs at a level from L0 (every gate human) to L3 (AI-reviewed plans and code, optional auto-merge of green low-risk pull requests); the default is L2, where an AI critic and an AI reviewer decide the routine gates and a person decides risky plans and code, escalations and the merge. A task can override its project's level. Nobody critiques, verifies or reviews their own plan or code. See [policy.md](policy.md).

### Hands-Free Runners
The web server can claim tasks itself: a runner has a coding tool, roles, an optional project, a model and a permission mode, and launches the tool headless in the project directory with the task and the phase skill as the prompt. See [runner.md](runner.md).

### Built-In Verification and Diff Guards
The server runs each project's commands on submitted code in the task's worktree, before any review, and reads the diff itself: weakened tests go back to the coder, and protected paths or an oversized diff raise the risk to high.

### Pull Request Follow-Up
With the `gh` CLI, the server follows every open pull request: a merged one completes the task (archiving it when the project asks), a closed one goes to a person, a change request on GitHub sends the task back to the coder, and under L3 with `autoMerge` a green low-risk one merges itself. The portal says when this sync is off or failing.

### Composable Roles
A role is a phase an agent works; an agent or runner has one or more (an agent that names none gets all but `verify`):
- **refine** — Turns drafts into ready tasks
- **plan** — Writes implementation plans with a validation plan
- **plan_review** — Critiques plans
- **code** — Writes the code and tests
- **verify** — Runs the verification commands (the server has a built-in verifier)
- **review** — Reviews code with a verdict
- **pr** — Pushes the branch and opens the pull request

### Real-Time Updates
SSE-powered live updates propagate changes to the web UI instantly, including the claims and submissions agents make through the MCP server. Task creation and status changes appear without manual refresh.

### Web Dashboard
Kanban-style board with four columns (Pending, In Progress, Needs you, Done), a **Needs you** inbox, task detail pages with decision panels, runners, agent monitoring, an activity feed with flow metrics, project management with autonomy and profile settings, and install tools.

### MCP Server for Agents
Stdio MCP server (`packages/mcp`) that operates directly on the local database — no running server required. It is the only agent channel: claiming, submitting, reading, listing, creating and archiving tasks are typed tools with JSON results. `bun run install:mcp` registers it with every installed coding tool, and runner jobs get it automatically.

### AI Skills
Pre-built agent skill files that guide coding agents on how to use the AgentQ MCP tools and interact with the system consistently. Includes workflow protocol, phase intelligence, worktree management, and guardrails.

### Feedback Loops
Both planning and coding phases support iteration: plans can be revised, code can be reworked after review, and stuck tasks can be unblocked.

### On-Demand AI Reviews
A person can request an AI code review from the task page (under L0 the AI review is advice only), which opens the task for a reviewer agent to claim and evaluate.

### Task Archive
Complete tasks can be archived from the board (**Archive** button on complete cards and on the task page), the MCP server (`archive_task`) or the `agentq-archive` skill. Archiving writes two Markdown files to `{project.workingDirectory}/archive/`: `<date>-<id8>-<slug>.summary.md` (key facts, description, what was done, agents) and `<date>-<id8>-<slug>.detailed.md` (every field, message, status change, agent session and activity event, plus the raw task JSON). The pull request is read from the conversation, or passed explicitly. The task then gets `archivedAt` / `archivePath` and leaves the board and `list_tasks`. The logic lives in `packages/shared/src/archive.ts`.

### Soft Delete
Tasks, projects, and agents support soft deletion with restore capability. Hard deletion available via explicit flag.

### Git Worktree Isolation
Code changes are isolated in git worktrees — one per task — avoiding cross-task interference during parallel development.

---

## 2. Core Components

### Web Portal
React SPA dashboard for human supervision (`packages/web-ui`). The sidebar has these pages:
- **Needs you** (`/inbox`) — every task waiting for a person, grouped by what they must do (answer a blocker, approve a plan, review code, merge a pull request, refine a draft) and oldest first. Above the pull requests, a notice says when the PR sync is off, and a "sync error" badge marks a pull request `gh` failed on
- **Board** — Kanban with 4 columns (Pending, In Progress, Needs you, Done) and color-coded headers. It lists every task of the selected project, page by page. Cards show the status, priority, branch, round chips (`R2/3` AI reviews used against the project's limit, `P1/2` plan critiques), a verification badge, the pull request with its checks, and why a queued task is not picked up (`held: plan pending`, `waits for N tasks`); complete cards have an **Archive** button
- **Search & filters** — On the board: search by title or branch, filter by status, agent and project
- **Task creation modal** — Full form with project, title, description, priority, branch, merge branch, type, risk, autonomy override, plan requirement toggle, save as draft, steer details, guardrails and acceptance criteria
- **Task detail page** (`/tasks/:id/details`) — A page of its own, with an **Actions** card for what the status waits for, the task's fields in a sidebar (editable while no agent holds the task), the markdown description, steer details, guardrails, acceptance criteria with their evidence, the plan and its validation plan, review findings by round, related tasks (subtasks and dependencies), and tabs for the conversation, the handoffs and the status history. The actions depend on the status: approve or request changes on a plan or on code, request an AI review, **Re-plan**, **Promote** a draft, **Mark merged** or **Request changes** on an open pull request, **Unblock** an active task, **Cancel** (a split task takes its unfinished subtasks with it) and **Archive** a complete task
- **Decision panels** — What a person needs to decide, in one place. A plan waiting for approval, or blocked in planning or plan critique, shows the plan, the critic's review with the critique count, the plan findings (tick one to have the planner answer it again) and the commands an approval lets the verifier run, flagged when they are off the allowlist or chain commands. Code waiting for review, or blocked in review or verification, shows the AI verdict and round count, the verification, the diff size, the risk, the criteria and the findings: answered findings can be reopened with a change request, and open ones accepted. A blocked task shows the agent's question and an answer box with the statuses allowed for the phase it was blocked in. An open pull request shows when the PR sync last looked, or why it is not looking
- **Runners** — Create and edit runners (tool, roles, project, model, effort, concurrency, poll interval, permission mode), start and stop them, and follow every job's live log. It also shows the built-in verifier's status and warns when no runner may critique or review another's work
- **Agents view** — Table with the agent (tool and ID), model, role, session and last seen; filterable by role and tool
- **Activity** — Global timeline of task lifecycle events, newest first and grouped by day (25, 50 or 100 events), under a **Metrics** panel, "How the flow is doing" (`GET /api/metrics`): human decisions per task, tasks that reached the pull request without a person, AI review rounds per pull request, escalations, tasks sent back after an AI approval and runner reverts. The page has no task, agent or date filters
- **Projects management** — Create, edit and delete projects. A new project's commands are detected from the repository. Editing has four tabs: **General** (name, working directory, default merge branch, archive on merge, Definition-of-Ready mode), **Autonomy** (level L0–L3 and every policy setting, including auto-merge at L3), **Commands** (install, build, test, lint, typecheck, the verify timeout) and **Guardrails** (shared guardrails, protected paths, size limits, verify allowlist). See [policy.md](policy.md#settings)
- **Tools page** — Install steps for the MCP server and the skills
- **Real-time updates** — SSE connection for live refresh
- **Light/dark theme** — Persistent via localStorage

### Web Server
Pure Bun HTTP server serving on a single port. Responsibilities:
- REST API for all CRUD and workflow operations on tasks, projects, agents, runners, activity and flow metrics (`/api/metrics`), plus `/api/meta` (skills bundle version, the verifier's state and the PR sync's state)
- Server-Sent Events endpoint for real-time streaming to connected clients
- Static file serving for the pre-built web UI
- Request validation via Zod schemas. The agent submissions (`POST /api/tasks/:id/submit-plan`, `submit-code`, `submit-review`, `submit-plan-review`, `submit-verification`, `submit-refinement`, `submit-pr`, `report-blocker`) take the MCP tools' arguments without `taskId` and parse them with the same schemas (`agentSubmitSchemas` in `@agentq/shared`); agents normally use MCP
- Runner engine: claims tasks for the configured runners and launches their coding tools headless; see [runner.md](runner.md)
- Built-in verifier: runs each project's commands on submitted code in the task's worktree (`AGENTQ_VERIFY_WORKER=0` turns it off; code then goes to review marked as not verified)
- PR sync: with `gh`, checks every open pull request each `AGENTQ_PR_SYNC_SEC` (`AGENTQ_PR_SYNC=0` turns it off); see [policy.md](policy.md#pull-requests)
- Sweeper: every minute, expired claims of hand-opened sessions go back to the queue and reviews nobody eligible picked up go to a person
- Automatic Vite dev server management in development mode
- CORS support for development
- Local user only: it listens on loopback (`AGENTQ_HOST`), and before any route runs it refuses requests a web page could forge: a `Host` that is not localhost, an IP address or listed in `AGENTQ_ALLOWED_HOSTS` (403), a state-changing request from another `Origin` (403), a POST/PUT/PATCH that is not `application/json` (415)
- Claim tokens never leave it: every JSON response and SSE event drops `claimToken`, and runner job output shows `[claimToken]` in its place
- Custom argv runners (tool `custom`, or `extraArgs`) only with `AGENTQ_ALLOW_CUSTOM_RUNNERS=1`

### MCP Server
Stdio [MCP](https://modelcontextprotocol.io) server (`packages/mcp`) for agent-to-system interaction. [mcp.md](mcp.md) has every tool with its inputs, and a test keeps that file in step with the registered tools. In short:
- **claim_task** — claims the highest-priority task one of the agent's roles works (refine, plan, plan_review, code, verify, review, pr; default all but verify) and returns the brief, the phase skill and a claim token
- **get_task_brief** — the compact brief to continue a task (an independent one for plan critique, verification and review)
- **get_task** / **list_tasks** — read a task with its findings, evidence and handoffs, or list task summaries filtered by status and project (archived tasks left out)
- **get_skill** — the current text and version of an AgentQ skill
- **submit_refinement** — makes a draft ready: criteria, type, risk, scope, open questions
- **submit_plan** / **create_subtask** — submit a plan with its validation plan, and split the task into held subtasks; the autonomy policy sends the plan to the AI critic or to a person
- **submit_plan_review** — a plan critique: verdict and findings
- **submit_code** — the worktree with evidence per criterion; the task goes to verification or review
- **submit_verification** — a verification run, for agents with the `verify` role
- **submit_review** — code review findings with an approve, request_changes or needs_human verdict; the policy routes the task
- **submit_pr** — records the pull request (URL, branches, commit, authors) and moves the task from Merging to PR open (`submit_merge` is its deprecated alias)
- **report_blocker** — stops with a reason and a question: the task goes to `needs_human`
- **heartbeat** — extends the lease of a claim made by a hand-opened session
- **post_comment** — adds a note to a task without changing its status
- **list_projects** / **create_task** — create tasks with full metadata (description, priority, branch, acceptance criteria, guardrails, steer details, plan requirement, draft)
- **archive_task** — writes a complete task's summary and detailed record to `{project}/archive/` and takes it off the board (`pullRequests`, `overview`, `force`, `directory`)
- **JSON results** — every tool returns `{ success, ... }` as text and structured content
- **Direct database access** — no server dependency; `AGENTQ_DB_PATH` comes from the tool's MCP config

### Database
Local SQLite database storing all system data:
- Tasks with full metadata, context, and workflow state
- Projects representing repositories, with their autonomy level, policy and profile
- Agents with session tracking, and the runners the server launches
- Activity events for audit trail
- Normalized conversation entries and status history
- Review findings, evidence and handoffs in their own tables (`task_findings`, `task_evidence`, `task_handoffs`)
- Migration system for schema evolution

### AI Skills
Agent instruction files that define the exact protocol for interacting with AgentQ:
- **agentq-claim** — Full protocol: claim → work → submit → repeat. Includes identity info, MCP tool reference, phase intelligence table, working directory rules, worktree management, git safety rules, message format templates, autonomy guidelines, and strict guardrails. It routes to the phase skill that matches the task's status
- **The phase skills**, one per role: **agentq-refine** (turns a draft into a ready task), **agentq-plan** (writes or revises the plan), **agentq-plan-review** (critiques a plan), **agentq-code** (implements in the task's worktree), **agentq-verify** (runs the verification commands), **agentq-review** (reviews the commits) and **agentq-pr** (pushes the branch and opens the pull request). The plan-review, verify and review skills work from an independent brief
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
- **Subtasks**: parentId, blockedBy (claimable only when those are complete; a canceled or deleted one sends the task to `needs_human`), held (waiting for the parent's plan approval), planSubmission (open questions, suggested risk, proposed subtasks, touched paths, size warnings). Canceling a task cancels its unfinished subtasks
- **Scope**: type (with a description template and agent guidance per type), nonGoals, references, dorIssues (Definition-of-Ready problems found at creation or edit; projects choose warn, enforce or off)
- **Handoffs**: structured notes between phases in `task_handoffs` (phase, round, agent, summary, decisions, risks, next); `contexts` keeps the plain summaries
- **Evidence**: validationPlan, approvedPlan (frozen at approval), headSha, commits (the commit of every code submission, verification and PR, with its round and branch, read from the worktree by the server), diffStats, verification (the latest result with its evidence ids, tamper strikes and the tampering a person accepted; "not verified" while a new submission waits for the verifier), riskReasons, approval (who approved the code and the commit the PR ships); evidence rows live in `task_evidence`
- **Priority**: Numeric value, higher = more urgent
- **Branching**: recommendedBranch, realBranch, mergeBranch (default: the project's defaultMergeBranch), worktreePath
- **Pull request**: pullRequest (URL, number, state, head branch and commit, who merged it, the reviewers asking for changes, the checks, and `checkedAt`, when the PR sync last read it from GitHub)
- **Autonomy and review**: type (feature/bug/refactor/docs/chore), risk (low/medium/high), autonomy override, planRound, codeRound, verifyFailures, roundBaseline, producers (who produced each phase's artifact, with the identities and model keys of every round), lastReview, leaseExpiresAt; review findings live in `task_findings` (ids like `R2-3`). See [policy.md](policy.md)
- **Workflow**: requiresPlan flag (a person can change it before work starts: draft, plan_requested, ready_for_code), status (one of 23 lifecycle states, section 4), assignedAgent reference (tool, model, agentId, sessionKey, identities, modelKey, runnerId), claimToken (secret of the current claim), blocker (set in `needs_human`), revertStreak
- **History**: chronological conversation thread, status transition history, agent context snippets
- **Timestamps**: created_at, updated_at, deleted_at (soft delete)
- **Archive**: archivedAt, archivePath (the summary file; the detailed record sits next to it)
- **Project**: belongs to one project via projectId

### Agent
A coding agent that claims and works on tasks. Contains:
- **Identity**: auto-generated ID (`tool@version|model`), toolName, version, model
- **Role**: the role its latest claim acted as (refine, plan, plan_review, code, verify, review or pr); agents and runners claim with a list of roles
- **Session**: sessionId (UUID), host, started_at, last_seen
- **Lifecycle**: soft delete support

### Runner
A worker inside the web server that claims tasks and launches a coding tool headless (see [runner.md](runner.md)). Contains:
- **Identity**: UUID, name
- **Tool**: `claude`, `codex`, `opencode`, `gemini` or `custom`, with a model, an effort level and extra arguments (a custom argv only with `AGENTQ_ALLOW_CUSTOM_RUNNERS=1`)
- **Scope**: one or more roles, and optionally one project
- **Execution**: concurrency, poll interval, permission mode (`safe` or `full`) and whether it is enabled

### Project
A local repository that tasks belong to. Contains:
- **Identity**: UUID, displayName
- **Location**: workingDirectory (absolute path to repo)
- **Profile**: commands (install/build/test/lint/typecheck), protected paths, shared guardrails, size limits (max diff lines, max files per plan, max criteria per task), verifier timeout and allowlist, archive when the pull request is merged, Definition-of-Ready mode
- **Autonomy**: level L0–L3 (default L2) and policy settings (plan critique rounds, review rounds, failed verifications, different reviewer model, spot checks, reviewer wait, lease, auto-merge at L3); see [policy.md](policy.md#settings). The portal edits all of them under **Projects → Edit**
- **defaultMergeBranch**: branch new tasks target unless they name one; detected from `origin/HEAD` when the project is created (falls back to `main`/`master`), editable
- **Lifecycle**: timestamps, soft delete support

### ActivityEvent
An audit log entry recording system events. Contains:
- eventType (e.g., task_created, plan_submitted, code_approved)
- taskId, actor, details, timestamp

### ConversationEntry
A message in a task's conversation thread. Contains:
- authorName (format: `"agentName|tool|model"` for agents, `"user"` for humans)
- timestamp, message body, messageType (user/agent/refine/plan/plan_review/code/verify/review/merge/system; `plan_review` is a plan critique, `review` a code review)

### TaskBrief
What an agent reads to continue a task (`packages/shared/src/brief.ts`, MCP `get_task_brief`, the runner prompt): approved plan and validation, criteria, the tasks it starts after (`dependencies`), open findings, the latest handoff per phase, project commands, guardrails and size limits, round, and what people said since the last submission. The phases that check another agent's work (plan critique, verification, code review) get an **independent brief** instead (`buildIndependentBrief`): the task, criteria, plan, guardrails, commands and findings to verify, never the author's conversation, handoffs, messages or evidence (see [policy.md](policy.md#independent-checks)).

### Diff guards
`packages/shared/src/diff.ts` reads a task's diff against its merge branch: size, changed files, and test tampering (deleted or moved-out tests, skipped or focused tests, lowered or removed coverage thresholds). The workflow runs it on every `submit_code` and `submit_verification` (outside the database transaction), so protected paths and `maxDiffLines` raise the risk and weakened tests send the code back whether or not the built-in verifier runs; the verifier and the L3 auto-merge (on the PR's files) use the same rules.

### StatusHistoryEntry
A record of a task status transition. Contains:
- pre_status, new_status, timestamp, actor (`user`, an agent id, `runner` or `system`)

---

## 4. Task Workflow

### States (23 total)

The state machine lives in one place: `packages/shared/src/catalog.ts` (statuses, what each means, claim rules, allowed edges) and `packages/shared/src/workflow.ts` (`transitionTask`, the only function that changes a status). Where a submission sends the task is decided by the autonomy policy in `packages/shared/src/policy.ts` (see [policy.md](policy.md)); the README draws the states and their edges. The MCP server, the web API and the runner all call the workflow; `PUT /api/tasks/:id` cannot change status, history, conversation, contexts or the assignee, and answers `409` in a status the catalog marks not editable (while an agent holds the task, or once it has a PR open, is complete or canceled). Once a plan is approved the acceptance criteria are frozen with it: changing them needs the task back in planning. The web UI reads the same catalog (`@agentq/shared/catalog`).

The task lifecycle moves through these states:

**plan_requested** (New) → Initial state when task requires planning. Pending agent assignment.

**planning** → Agent is actively developing an implementation plan, with its validation plan and, for big work, subtasks. A blocking open question sends the task to `needs_human` before any critique.

**plan_review_requested** / **plan_reviewing** → Under L2+ an AI critic reviews the plan (never an agent that wrote the plan). Approve sends a low-risk plan to `ready_for_code` (or `split`, when it created subtasks) and a riskier one to `waiting_plan_review`; request changes goes to `plan_changes_requested`; the critique limit or a `needs_human` verdict goes to `needs_human`.

**waiting_plan_review** → Plan waiting for a person: under L0 and L1 after every `submit_plan`; under L2+ after the critic approved a medium or high-risk plan, or when no critic picked it up in time.

**plan_changes_requested** → A person or the AI critic requested plan modifications, tracked by finding id. Feedback loop back to planning.

**ready_for_code** → Initial state when task does not require planning, or plan was approved. Ready for implementation.

**coding** → Agent is actively implementing the task.

**verify_requested** / **verifying** → Code submitted to a project with commands: waiting for, and being checked by, the built-in verifier, which runs the project's commands in the task's worktree (never an agent that wrote the code). Green goes on to review; red goes back to `changes_requested`; too many reds in a row (or tests weakened twice) go to `needs_human`.

**code_review_requested** → Waiting for an AI reviewer: under L1+ right after `submit_code` (and verification), under L0 when a person requests it. Never claimed by an agent that wrote the code in any round.

**reviewing** → Agent is actively reviewing the submitted code. Its verdict routes the task by autonomy level, risk and round: `approved`, `changes_requested`, `waiting_code_review` or `needs_human`.

**waiting_code_review** → Code waiting for a person: under L0 after every submit; under L1+ only when an AI approval is high risk or sampled, or no reviewer picked it up, or a person answering a blocker sent it there. Can trigger an on-demand AI review.

**changes_requested** → A person or the AI reviewer (L1+) asked for changes, on the code or on the open pull request; the findings are tracked by id. Feedback loop back to coding.

**approved** → Code accepted by a person, or by the AI reviewer under L1+. Ready for the pull request.

**merging** → An agent with the `pr` role is pushing the branch and opening the pull request.

**pr_open** → The pull request is open (replaces the old `merged`, which only ever meant that). A person reviews and merges it on GitHub; the server's PR sync (`gh`) then completes the task, or sends it to `needs_human` if the PR is closed. A change request on the PR (a GitHub review, or **Request changes** on the task page) sends the task back to `changes_requested` with the PR kept: the fix goes through verification and review again and the `pr` phase updates the same PR. Under L3 with `autoMerge`, a green low-risk PR whose head is the approved commit merges itself. A person can also mark it merged, which is what the task page asks for when the PR sync is off or failing.

**complete** → All work finished: its pull request was merged, or every subtask of a split task finished. Terminal state, apart from archiving.

**canceled** → Work stopped. Can be entered from any state except `complete` and `canceled` (the catalog's `cancelable`); a split task's unfinished subtasks are canceled with it. Canceled tasks are not on the board.

**draft** → A rough task; an agent with the `refine` role (or a person, "Promote") makes it ready.

**refining** → An agent with the `refine` role is writing the criteria, risk and scope.

**split** → The plan split the task into subtasks; it completes when they all finish (at least one completed). If every subtask was canceled it goes to `needs_human`.

**needs_human** → The task stopped with a question only a person can answer. It gets there when an agent called `report_blocker` (push rejected, missing credentials, contradictory task); when a limit was hit (plan critiques or AI reviews that keep asking for changes, failed verifications or weakened tests, a reviewer reopening a finding the coder answered, twice); when a critic or reviewer returned a `needs_human` verdict, or the plan has a blocking open question; when the pull request was closed without merging, or the commit pushed is not the approved one; when a runner job ended three times in a row without submitting (`AGENTQ_MAX_REVERTS`); when a task it starts after was canceled or deleted; or when every subtask of a split task was canceled. [policy.md](policy.md#escalations) lists each trigger. The task stores a `blocker` (reason, question, phase) and nothing claims it until a person answers and picks where it goes next: the statuses offered depend on the phase it was blocked in (`RESOLVE_TARGETS` in the catalog).

### User Actions
- Approve plan, request plan changes (plan findings can be ticked to reopen them)
- Approve code, request code changes (answered findings can be ticked to reopen them), or send the task back to planning (`request_replan`: the plan itself is wrong)
- Request AI review
- Promote a draft to ready
- Cancel task, unblock a stuck active task (refining, planning, plan critique, coding, verifying, reviewing or merging; the runner job still working on it is stopped)
- Answer a blocked task (`resolve_blocker`): the answer goes to the conversation and the task moves to a status allowed for the phase it was blocked in. A plan blocker sent to `ready_for_code` approves the plan (frozen, subtasks released: `split`); a coding, verification or review blocker can go back to `plan_changes_requested`; dependencies that were canceled or deleted are dropped. On an escalated plan, review or verification the answer can also reopen findings, accept open ones and be recorded as a change request (see [policy.md](policy.md#escalations))
- Change whether a task requires a plan before work starts (moves it between `plan_requested` and `ready_for_code`)
- Request changes on an open pull request (`request_pr_changes`): the task goes back to `changes_requested` with the PR kept
- Mark the PR merged (when the PR sync cannot see GitHub)
- Archive a complete task
- Edit a project's autonomy level, policy and profile

### Agent Actions
- Claim task (any of the agent's roles); the claim returns a `claimToken` every submit must present, and the brief to work from
- Submit what the phase produces: a refinement, a plan (and its subtasks), a plan critique, code, a verification, a code review or the pull request
- Report a blocker (`report_blocker`) instead of submitting partial work
- Send a heartbeat during long silent work, from a hand-opened session (its claim is a lease)

---

## 5. Board Column Mapping

| Board Column | Task States Shown |
|---|---|
| **Pending** | draft, plan_requested, plan_changes_requested, plan_review_requested, ready_for_code, changes_requested, verify_requested, code_review_requested, approved |
| **In Progress** | refining, planning, plan_reviewing, coding, verifying, reviewing, merging, split |
| **Needs you** | waiting_plan_review, waiting_code_review, needs_human, pr_open |
| **Done** | complete |

The **Needs you** page lists the same tasks, plus drafts that are not ready, with what each one needs (answer, approve the plan, review the code, merge the PR, refine the draft), oldest first.

Canceled and archived tasks are not shown on the board.
