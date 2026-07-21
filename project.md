# AgentQ

ATQ is a local tool designed to act as a "100x engineer" assistant for managing coding-agent work across multiple projects.

## Purpose

This project aims to create a shared task queue for local coding agents such as OpenCode, Codex, Claude, and others. The system will maintain a backlog of tasks from different projects and allow agents to pull work items, complete them, and continue from a well-defined context.

## Problem Statement

When working across multiple projects, it is difficult to track what each coding agent is doing, review its output consistently, and apply the same workflow or standards across clients and repositories. A centralized system would reduce fragmentation and make it easier to delegate execution while maintaining oversight.

## Proposed Solution

The system will consist of five core components:

- Web portal
- CLI tool
- Web server
- Local database
- AI skills
- SSE (Server-Sent Events) for real-time updates

### Web Portal

The web portal will provide a visual task board with columns representing action buckets and priorities. The board will support configurable columns so users can decide which action columns to show or hide, and each column can filter which underlying workflow statuses are visible inside it. It will include a board view for tasks, a task detail drawer, an agents view showing which agent is working on which task, a projects view for managing projects, and an activity feed for monitoring task lifecycle events. The interface will be labeled "ATQ - your 100x engineer tool". The board receives real-time updates via SSE (Server-Sent Events) so changes made by agents or other users appear without manual refresh.

#### Recommended web view features

The web experience should be centered around a fast, local-first task management dashboard that lets a user supervise work without leaving the browser.

1. Task board view
   - User actions: create a task, open a task detail panel, change task priority, move a task between action-based columns, configure which columns are visible, and filter by project, status, agent, tool, or model. Users can search by title or branch and refresh the board. Dragging tasks within a column reorders by priority; moving between columns is not allowed.
    - What the user sees: a Kanban-style board with columns for Pending, In progress, Need review, and Done. Each column groups tasks by the next action required from the user or the agent, and can optionally show only selected workflow statuses for that bucket. Task cards show title, priority, branch, current status, and the agent currently working on it, plus badges for planning or review requirements.
   - Overall design: a desktop-first layout with a left sidebar for projects, a top bar for search and filters, and a central board that feels like a calm command center rather than a heavy ticketing system.

2. Task detail drawer
   - User actions: edit task metadata, add comments, approve a plan, request plan changes, approve or request code changes, request an on-demand AI code review, cancel a task, merge approved work, and mark a task complete.
   - What the user sees: the full task description, acceptance criteria, recommended and real branch names, workflow history, conversation thread, context snippets from agents, and the current agent activity timeline.
   - Overall design: a right-side drawer or modal that opens over the board, using tabs for summary, conversation, and history so the user can inspect details without losing context.

3. Agents view
   - User actions: inspect an agent session, view which tasks it is handling, filter by role or tool, and review recent activity.
   - What the user sees: a list or grid of agents with their name, tool, model, role, session ID, last seen timestamp, and current task. A compact activity feed should show recent updates and review decisions.
   - Overall design: a table-like view with strong visual separation between active and inactive agents, making it easy to spot stalled or idle sessions.

4. Activity and monitoring experience
   - User actions: review recent task updates, follow a task lifecycle from creation to completion, and filter events by agent, date, or workflow action.
   - What the user sees: a global activity stream showing task state changes, comments, approvals, review requests, merges, and completions.
   - Overall design: a timeline-style feed that complements the board and helps the user understand what happened and when.

5. Visual and interaction guidelines
   - Use clear action-based columns labeled Pending, In progress, Need review, and Done.
   - Provide board settings so users can decide which columns to show or hide and choose which workflow statuses are visible inside each column. This allows the board to be tailored for backlog triage, execution, review, or completion workflows.
   - Keep the interface lightweight and fast, with keyboard-friendly navigation and minimal click depth for common actions.
   - Show important state transitions with explicit confirmation dialogs for actions such as canceling a task, approving code, or completing a merged task.
   - Use compact empty states and helpful hints so the first-time user understands how to create a task, assign work, and monitor progress.

6. Board column mapping (hardcoded)
   The board columns map workflow states to action buckets as follows:
   - **Pending**: New, Ready for Code, Plan Changes Requested, Code review requested, Changes Requested, Approved
   - **In Progress**: Planning, Coding, Reviewing, Merging
   - **Need Review**: Waiting Plan Review, Waiting Code Review
   - **Done**: Complete, Merged

### CLI Tool

The CLI tool will allow coding agents to interact directly with the local database by pulling tasks, updating progress, and reporting completion. It will operate independently of the web server, while sharing the same contracts and domain entities.

#### Recommended CLI features

The CLI should be built as a practical command layer for coding agents, with simple commands for discovery, task claiming, progress updates, and handoff to review. The CLI binary is named `atq` and operates directly against the local SQLite database, requiring no running server.

1. Task listing and inspection
   - Agent actions: list all tasks or get a specific task by ID.
   - What the agent sees: formatted task details with ID, title, status, priority, and related metadata.
   - Overall design: commands like `atq list` to list all tasks and `atq get <id>` to inspect a single task in detail.

2. Task creation
   - Agent actions: create a new task with title, description, acceptance criteria, priority, recommended branch, requires-plan flag, and merge branch.
    - What the agent sees: confirmation of task creation with the new task's ID and initial status (New if requiresPlan, Ready for Code otherwise).
   - Overall design: a command like `atq create <title>` with optional flags for all other fields.

3. Task claiming
   - Agent actions: claim the highest-priority eligible task via `atq claim` with agent identity arguments (name, version, model, role, session-id).
   - What the agent sees: the claimed task's full details and confirmation of the new status.
   - Overall design: the CLI automatically selects the highest-priority unclaimed task based on the agent's role, creates or updates the agent record, transitions the task to the appropriate working state, and outputs structured task details. Role-to-status mappings are: planner (PlanRequested, Plan Changes Requested), implementer (Ready for Code, Changes Requested, Approved), reviewer (Code Review Requested), senior (all), architect (planner + reviewer).

4. Task progress updates and handoff
   - Agent actions: submit a plan, submit code, submit review, and submit merge. All these actions add a conversation entry with the agent's context and progress notes.
   - What the agent sees: confirmation of the action taken, any feedback from the system, and the updated task status.
   - Overall design: commands like `atq submit-plan <id>`, `atq submit-code <id>`, `atq submit-review <id>`, and `atq submit-merge <id>` that accept relevant parameters and provide structured output.
   - Submit-merge requires branch, commit hash, and authors; worktree path is optional.
   - Review-specific behavior: a user action can move a task to **Code review requested**; once a reviewer agent claims that task, the system moves it to **Reviewing** and the CLI exposes that state in its output so the agent can see it is actively being reviewed.
   Note: Agents lose ownership of the task after submitting a plan, code, or review. The system automatically updates the task status and clears the assigned agent.

### Web Server

The web server will run locally and support interaction with the web portal. It will expose a REST API for managing the system entities and task workflow, running on port 3000 by default. Endpoints include CRUD for tasks, projects, and agents (read-only for agents); workflow transition endpoints (approve plan, request plan changes, approve code, request code changes, request AI review, confirm completion, cancel, unblock); agent and project listing with filtering; activity feed with query filters; and an SSE endpoint (`/api/events`) for real-time event streaming to the web portal.

### Local Database

The local database will store all queue data, task metadata, and project information. It will be responsible for persistence only and will not contain business logic.

### AI Skills

AI skills will guide coding agents on how to use the CLI and interact with the ATQ backend consistently. In a second phase, coding assistants will be able to create new tasks using AI capabilities, so users can submit well-defined, concise, context-rich tasks that other coding agents can begin working on immediately.

## Domain Entities

All entities should have a unique identifier in UUID format and created_at, updated_at fields.

### Project

A project represents a local repository or working directory. Its name is unique and acts as the primary identifier.

Example:
```json
{
  "id": "uuid",
  "name": "atq",
  "displayName": "AgentQ",
  "workingDirectory": "/users/boss/atq_repo",
  "created_at": "2026-07-09T12:00:00.000Z",
  "updated_at": "2026-07-09T12:00:00.000Z"
}
```

### Task

A task represents a unit of work assigned to an agent. It should include a clear title, a detailed description, acceptance criteria, optional implementation guidance, priority (number), a recommended branch name, flags for whether planning is required and whether review is needed, a target merge branch (defaulting to develop), a conversation thread, status, status history, and contextual metadata generated by agents.

| Field | Type | Description |
| --- | --- | --- |
| id | string | Unique identifier for the task in UUID format. |
| title | string | Short, human-readable task title. |
| description | string | Detailed explanation of the work to be done. |
| acceptanceCriteria | string[] | List of conditions that must be met for the task to be considered complete. |
| priority | number | Numeric priority value; higher values indicate higher urgency. |
| recommendedBranch | string | Suggested branch name for implementing the task. |
| realBranch | string | Actual branch used during implementation, if different from the recommendation. |
| requiresPlan | boolean | Indicates whether the task requires a planning step before execution. immutable |
| assignedAgent | AgentReference | Reference to the agent currently working on the task (name, tool, model). null when not assigned. |
| projectId | string | ID of the project this task belongs to. nullable. |
| mergeBranch | string | Target branch for merging the completed work. Defaults to develop. |
| status | string | Current lifecycle state of the task. |
| worktreePath | string | Absolute path to the worktree where code changes are located. Set by agent via `submit-code --worktree`. null when no worktree created. |
| conversation | ConversationEntry[] | Chronological list of messages exchanged about the task, including user messages and AI-generated updates. |
| history | StatusHistoryEntry[] | Chronological list of status transitions for the task. |
| contexts | string[] | List of context provided by coding agents each time they submit changes to the task. |
| created_at | string | Timestamp when the task was created. |
| updated_at | string | Timestamp of the last update to the task. |

Each conversation entry is a value object of type ConversationEntry with the following fields:

| Field | Type | Description |
| --- | --- | --- |
| authorName | string | Name of the author. For user messages, this is "user". For AI-generated messages, it must follow the format "agentName|tool|model". |
| timestamp | string | ISO 8601 timestamp for when the message was created. |
| message | string | The message content added by the user from the web view or by an agent through a CLI call. |

Each status history entry is a value object of type StatusHistoryEntry with the following fields:

| Field | Type | Description |
| --- | --- | --- |
| pre_status | string | The status before the transition. |
| new_status | string | The new status after the transition. |
| timestamp | string | ISO 8601 timestamp for when the status changed. |

Example:
```json
{
  "id": "uuid",
  "title": "Add task queue CLI commands",
  "description": "Implement the commands required to create, claim, and complete tasks.",
  "acceptanceCriteria": [
    "Agents can list available tasks",
    "Agents can claim a task",
    "Agents can mark a task as completed"
  ],
  "priority": 100,
  "recommendedBranch": "feature/task-queue-cli",
  "realBranch": "feature/task-queue-cli",
  "requiresPlan": true,
  "mergeBranch": "develop",
  "status": "plan_requested",
  "conversation": [
    {
      "authorName": "user",
      "timestamp": "2026-07-09T12:05:00.000Z",
      "message": "Please add a CLI command to create tasks from the terminal."
    },
    {
      "authorName": "senior-1|opencode|kimi2.5",
      "timestamp": "2026-07-09T12:06:00.000Z",
      "message": "I added the command and updated the task status to in-progress."
    }
  ],
  "history": [
    {
      "pre_status": "plan_requested",
      "new_status": "in-progress",
      "timestamp": "2026-07-09T12:06:00.000Z"
    }
  ],
  "contexts": [
    "Repository root: /Users/boss/projects/atq",
    "Relevant files: src/cli.ts, src/db.ts",
    "Recent error: sqlite database locked"
  ],
  "created_at": "2026-07-09T12:00:00.000Z",
  "updated_at": "2026-07-09T12:06:00.000Z"
}
```

### Agent

An `Agent` represents a coding agent (human-operated or automated) that can claim, work on, and complete tasks. Agents register automatically when they interact with the CLI; registration metadata is attached to task comments and conversation entries so reviewers can trace which agent performed each action and with what tool.

Key fields:

| Field | Type | Description |
| --- | --- | --- |
| `toolName` | string | Human-readable tool name, e.g. `github copilot` or `opencode`. |
| `version` | string | Tool version, e.g. `1.2.1`. |
| `model` | string | Model identifier used by the agent, e.g. `raptor`. |
| `id` | string | Canonical agent identifier formed by concatenating `toolName`, `version`, and `model` (see rule below). |
| `role` | string | Agent role such as `planner`, `implementer`, or `reviewer`. |
| `sessionId` | string | Session identifier for this agent run (UUID or similar). |
| `host` | string | Hostname or path where the agent ran (optional). |
| `started_at` | string | ISO 8601 timestamp when the agent session started (optional). |
| `last_seen` | string | ISO 8601 timestamp of the last activity from the agent (optional). |

ID concatenation rule:
- Produce `id` by normalizing `toolName` (lowercase, replace spaces with hyphens), then concatenating as: `<normalizedToolName>@<version>|<model>`.
- Example normalization: `github copilot` → `github-copilot`.
- Example id: `github-copilot@1.2.1|raptor`.

Author name convention:
- For conversation `authorName`, use `agentName|tool|model` for agent messages so the UI can present both a readable name and parseable metadata.

Example (current session) — demonstrates `toolName`, `version`, `model`, and the concatenated `id`:

```json
{
  "toolName": "github copilot",
  "version": "1.2.1",
  "model": "raptor",
  "id": "github-copilot@1.2.1|raptor",
  "role": "senior",
  "sessionId": "574fbc9f-b666-4eac-8c92-722a70e54d4d",
  "host": "/Users/sergio.sanchez",
  "started_at": "2026-07-10T00:00:00.000Z",
  "last_seen": "2026-07-10T00:10:00.000Z"
}
```

Store this metadata with task updates and comments so reviewers can filter and audit actions by tool, version, or model.
Most likely agents entities will be changing a lot as session ids changes on every new request.


## Workflow

This section describes how all the pieces work together to complete the task cycle. It covers task status transitions, how agents interact with the queue, and what data is exchanged with the database. It also explains how the web server provides a dashboard for monitoring active work, tracking agent activity, and steering tasks. The system is designed so users can maintain visibility and control over what agents are doing, while agents submit context, progress updates, and conversation entries consistently.

### Status transitions

The task lifecycle uses the following states and transitions. Each state represents a phase in the task workflow, and transitions define how tasks move between phases.


- **New** – Initial state after task creation only when `requiresPlan` is true. The task is pending assignment. (Flows to **Planning**, **Canceled**)
- **Planning** – Entered from **New**. An agent is actively developing an implementation plan. (Flows to **Waiting Plan Review**, **Plan Changes Requested**, **Canceled**)
- **Waiting Plan Review** – Entered from **Planning** when a plan is submitted for review. Awaits user feedback. (Flows to **Ready for Code**, **Plan Changes Requested**, **Canceled**)
- **Plan Changes Requested** – Entered from **Waiting Plan Review** when reviewers request modifications to the plan. The agent must revise and resubmit. (Returns to **Planning** or flows to **Canceled**)
- **Ready for Code** – Initial state after task creation only when `requiresPlan` is false, or Entered from **Waiting Plan Review** when the plan is approved. (Flows to **Coding**, **Canceled**)
- **Coding** – Entered from **Ready for Code**, or from **Changes Requested**. An agent is actively implementing the task. (Flows to **Waiting Code Review**, **Changes Requested**, **Canceled**)
- **Waiting Code Review** – Entered from **Coding** when code is submitted for review. It is also the state that a user can use to request an on-demand AI review. (Flows to **Code review requested**, **Approved**, **Changes Requested**, **Canceled**)
- **Code review requested** – Entered from **Waiting Code Review** when the user explicitly requests an on-demand AI review from the web UI. This state indicates that review is pending assignment. (Flows to **Reviewing**, **Canceled**)
- **Reviewing** – Entered from **Code review requested** when an agent claims the task for review. The task remains in this state while the agent performs the review and adds the review result to the conversation. (Flows back to **Waiting Code Review**, **Canceled**)
- **Changes Requested** – Entered from **Waiting Code Review** when reviewers identify issues requiring implementation changes. (Returns to **Coding**)
- **Approved** – Entered from **Waiting Code Review** when reviewers accept the submitted code. Ready for merge. (Flows to **Merged**)
- **Merging** – Entered from **Approved** when an agent is actively merging the implementation into the target `mergeBranch`. (Flows to **Merged**)
- **Merged** – Entered from **Approved** when the implementation is merged into the target `mergeBranch`. Awaits final task closure. (Flows to **Complete**)
- **Complete** – Entered from **Merged** after manual confirmation that all work is finished. This represents the final, optional verification step.
- **Canceled** – Can be entered from any state when a user chooses to stop work on the task.

Notes:
- "Changes Requested" and "Plan Changes Requested" are feedback loops. They return to Coding and Planning respectively, allowing agents to iterate on work.
- Each state transition must record a timestamp and create a corresponding entry in the task's history for audit and tracking purposes.
- requiresPlan: is immutable and cannot be changed after task creation. It determines whether the task starts in the Planning or Ready for Code state.

### User actions

The following user actions drive the workflow transitions described above:

- **Approve plan** – Moves a task from **Waiting Plan Review** to **Ready for Code**.
- **Request plan changes** – Moves a task from **Waiting Plan Review** to **Plan Changes Requested**.
- **Cancel task** – Moves a task from any active state to **Canceled**.
- **Approve code** – Moves a task from **Waiting Code Review** to **Approved**.
- **Request code changes** – Moves a task from **Waiting Code Review** to **Changes Requested**.
- **Request AI review** – Moves a task from **Waiting Code Review** to **Code review requested** when the user presses the web UI button to ask an agent to perform a one-off AI code review.
- **Unblock stuck task** – Moves a task from **Planning** to **Plan Changes Requested**, from **Coding** to **Changes Requested**, or from **Reviewing** to **Code Review Requested**, clearing the assigned agent so another agent can claim it.
- **Confirm completion** – Moves a task from **Merged** to **Complete**.

### Agent actions

The following agent actions drive the workflow transitions described above:
- **Submit plan** – Moves a task from **Planning** to **Waiting Plan Review**.
- **Submit code** – Moves a task from **Coding** to **Waiting Code Review**.
- **Submit review** – Moves a task from **Reviewing** back to **Waiting Code Review**. The review result is appended to the conversation, and the task is no longer considered to be in review.
- **Submit merge** – Moves a task from **Merging** to **Merged**.
- **Claim task** – An agent can take a task in different conditions like:
  - From **Ready for Code** to **Coding**. The agent is now responsible for implementing the task. 
  - From **New** to **Planning**, if the task requires planning, the agent can claim it.
  - From **Changes Requested** to **Coding**, if the task is in a feedback loop and requires further implementation.
  - From **Plan Changes Requested** to **Planning**, if the task is in a feedback loop and requires further planning.
  - From **Code review requested** to **Reviewing**, if the task is eligible for an agent to claim it.
  - From **Approved** to **Merging**, if the task is ready to be merged into the target branch. Agent commit and merge to the target branch and update the task status to Merged.


Note: 
  - Agents can only claim tasks that are in a state appropriate for their role and the task's requirements. The system should enforce these rules to prevent invalid transitions.
  - Agents only claim tasks that are not already claimed by another agent. The system should track which agent has claimed each task to avoid conflicts.
  - Agents must provide context and progress updates when claiming and working on tasks. This includes adding conversation entries, and recording any relevant metadata in the task's contexts field, this on each time the agent submits changes to the task.
  - Task status updates is handled by the system based on agent actions and user approvals. Agents do not directly set the task status; they perform actions that trigger status transitions according to the defined workflow.
  - User actions and agent actions are distinct. Users approve or request changes, while agents submit work and claim tasks. The system mediates these interactions to maintain a clear workflow and audit trail.


### Examples

Example 1: A task that requires planning and an on-demand AI review. (requiresPlan = true)
- **Task Creation**: A user creates a new task with `requiresPlan` set to true. The task starts in the **New** state.
- **Agent Claims Task**: An agent claims the task, moving it to the **Planning** state. The agent develops an implementation plan and submits it (adding the plan to the conversation), transitioning the task to **Waiting Plan Review**.
- **User Reviews Plan**: A user reviews the plan and approves it, moving the task to **Ready for Code**. 
- **Agent Claims Task**: The agent then claims the task for coding, transitioning it to **Coding**.
- **Agent Submits Code**: The agent completes the implementation and submits the code, moving the task to **Waiting Code Review**. 
- **User Requests AI Review**: The user presses the web UI button to request an on-demand AI review, moving the task to **Code review requested**.
- **Agent Claims Task**: An agent claims the task for review, moving it to **Reviewing**; the agent then submits the findings to the conversation and returns the task to **Waiting Code Review**.
- **User Reviews Code**: A user then reviews the code and approves it, transitioning the task to **Approved**. 
- **Agent Merges Code**: The agent merges the code into the target branch, moving the task to **Merged**. 
- **User Confirms Completion**: Finally, a user confirms completion, transitioning the task to **Complete**.

## Roles

Roles are used to define the responsibilities and permissions of agents within the system. Each agent is assigned a role that determines what actions they can perform on tasks.

There are three primary roles, planners, implementers, and reviewers. Each role has specific responsibilities and permissions within the task workflow.

### Planner
Responsible for creating implementation plans for tasks that require planning. Planners can claim tasks in the **New** or **Plan Changes Requested** states and submit plans for review.

### Implementer
Responsible for coding and implementing tasks. Implementers can claim tasks in the **Ready for Code** or **Changes Requested** states and submit code for review.

### Reviewer
Responsible for reviewing submitted code. Reviewers can claim tasks in the **Code review requested** state; once they claim one, the task moves to **Reviewing**. They can only submit reviews, and agents are not allowed to approve or request changes directly. Reviewers can provide feedback that moves the task back to **Waiting Code Review** with the review result captured in the conversation.

### Senior 

Is a combination of all three roles, allowing the agent to claim tasks in any state and perform all actions. Senior agents can create plans, implement code, and review submissions, providing flexibility for complex workflows or when a single agent needs to manage multiple aspects of a task.

### Architect

Is a combination if planner and reviewer roles, allowing the agent to create plans and review code but not implement it. Architects can claim tasks in the **New**, **Plan Changes Requested**, and **Code review requested** states, enabling them to oversee planning and review processes without directly coding.

## Agent Workflow

Coding agents interact with ATQ through the CLI using a structured protocol. The workflow is:

1. **Claim** a task using `atq claim --json`
2. **Read** the task status from the response
3. **Determine phase** based on status
4. **Work** on the task according to the phase
5. **Submit** using the appropriate `atq submit-*` command
6. **Repeat** until no tasks available

### JSON Output

All CLI commands support `--json` flag for structured output:
- `atq claim --json` returns task with embedded project object and agent identity
- `atq submit-* --json` returns success/failure with status transitions
- Error responses return `{ "success": false, "error": "..." }`

### Worktree Management

- **Create worktree** for coding, changes_requested, reviewing, and merging phases
- **Skip worktree** for planning and plan_changes_requested phases
- **Creation command**: `git worktree add /tmp/atq-{task.id} {task.recommendedBranch}`
- **Use existing**: If `task.worktreePath` is set, use that path instead of creating new
- **Store path**: Agent passes `--worktree /tmp/atq-{taskId}` on `submit-code` to persist path

### Git Safety

- **NO** `git add`, `git commit`, or `git push` during planning, coding, or reviewing phases
- **ALLOW** commits ONLY during merging phase (via `submit-merge`)

### Message Format

All `-m` messages must be in Markdown format with structured sections for each submission type.

## Unblock tasks caused by fails

Agents can fail or crash, leaving tasks in a state where they cannot progress. The system should provide mechanisms for users to unblock these tasks and allow other agents to take over.

Users must have the ability to unblock the task by taking the task to the previous state, allowing another agent to claim it. This is particularly important for tasks that are stuck in **Planning**, **Coding**, or **Reviewing** due to agent failures. 

User will do that in the web view with an option next to the cancel button.









 
