# AgentQ — Master Prompt

Build a local task queue system for managing coding-agent work across multiple projects. It provides a centralized backlog that allows AI agents (OpenCode, Codex, Claude, Kimi, Junie) to pull work items, complete them, and continue from well-defined context.

> Tagline: "If you want to be a 100x engineer, stop prompting and start queueing."

---

## 1. Architecture Overview

Five core components:

| Component | Description |
|-----------|-------------|
| **Web Portal** | React SPA dashboard with Kanban board, task details, agent monitoring, activity feed |
| **Web Server** | Single-port HTTP server (REST API + SSE + static file serving), pure Bun |
| **CLI** | Standalone binary CLI for agents to interact with the queue |
| **Database** | Local SQLite via `bun:sqlite` for persistence |
| **AI Skills** | Agent instruction files for consistent workflow integration |

Local-first — CLI operates directly on SQLite, no running server required for agent operations.

---

## 2. Tech Stack

| Technology | Usage |
|------------|-------|
| **Bun** `^1.2.8` | Runtime, `bun:sqlite`, `bun build --compile`, test runner |
| **TypeScript** `^5.8` | Everything — strict mode |
| **Commander** `^12` | CLI framework |
| **Zod** `^3.24` | Schema validation (shared) |
| **React** `^19.1` | Frontend UI |
| **React Router** `^7.6` | Client-side routing |
| **TanStack React Query** `^5.80` | Data fetching + cache |
| **Vite** `^6.3` | Build tool + HMR dev server |
| **Tailwind CSS** `^3.4` | Styling |
| **react-markdown** `^10` | Markdown rendering |
| **rehype-highlight** `^7` + **highlight.js** `^11` | Syntax highlighting |
| **remark-gfm** `^4` | GFM markdown support |
| **react-hot-toast** `^2.6` | Toast notifications |
| **focus-trap-react** `^12` | Modal focus management |
| **ESLint** `^10` + **Prettier** `^3.9` | Linting + formatting |
| **Husky** `^9` + **lint-staged** | Git hooks |

---

## 3. Project Structure

```
agent-task-queue/
├── package.json                       # Workspace root — 5 packages
├── tsconfig.json                      # ESNext, bundler resolution, strict
├── eslint.config.js                   # Flat config: TS + React + import rules
├── .prettierrc                        # Code formatting
├── project.md                         # Full project spec
│
├── packages/
│   ├── shared/src/                    # @agentq/shared
│   │   ├── index.ts                   # Re-exports everything
│   │   ├── types.ts                   # Enums (TaskStatus) + interfaces
│   │   ├── schemas.ts                 # Zod validation schemas
│   │   ├── database.ts                # SQLite: init, migrations, CRUD (~840 lines)
│   │   ├── workflow.ts                # Role/status mapping, transitions
│   │   ├── pagination.ts              # Paginated response helpers
│   │   ├── env.ts                     # Zod-validated env config
│   │   └── database.test.ts           # Tests (~580 lines)
│   │
│   ├── cli/src/index.ts               # @agentq/cli — Commander CLI (~580 lines, single file)
│   │
│   ├── web/src/index.ts               # @agentq/web — Bun.serve server (~740 lines, single file)
│   │
│   ├── web-ui/                        # @agentq/web-ui — React SPA
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main.tsx               # React root (QueryClient, Router, ThemeProvider, Toaster)
│   │       ├── App.tsx                # Route definitions
│   │       ├── index.css              # Tailwind + CSS variables for light/dark
│   │       ├── lib/api.ts             # Typed fetch API client
│   │       ├── hooks/useSSE.ts        # SSE EventSource with exponential backoff reconnect
│   │       ├── contexts/ThemeContext.tsx  # Light/dark theme with localStorage
│   │       ├── components/            # 19 components (Layout, TaskCard, modals, etc.)
│   │       └── pages/                 # 7 pages (Board, TaskDetail, Agents, Activity, Projects, Tools, InstallTool)
│   │
│   └── installer/src/                 # @agentq/installer — install scripts
│       ├── install-bin.ts             # Build + install agentq binary to ~/.local/bin
│       ├── install-skills.ts          # Copy workflow skill to agent config dirs
│       └── install-agents.ts          # Copy subagent files to opencode
│
├── skills/                            # Shared agent skill definitions
│   └── agentq-workflow/SKILL.md
│
├── agents/opencode/                   # Subagent definitions
│   └── agentq-fetcher.md
│
├── .opencode/                         # OpenCode-specific config
│   ├── skills/                        # 7 skills (agentq-workflow, agentq-create-task, openspec-*)
│   └── commands/                      # 5 custom commands
│
├── .claude/skills/                    # 5 openspec skills (no propose)
│
└── openspec/                          # Change proposals
```

---

## 4. Domain Entities

### 4.1 TaskStatus Enum

```typescript
enum TaskStatus {
  PlanRequested       = "plan_requested",        // "New" in docs
  Planning            = "planning",
  WaitingPlanReview   = "waiting_plan_review",
  PlanChangesRequested = "plan_changes_requested",
  ReadyForCode        = "ready_for_code",
  Coding              = "coding",
  WaitingCodeReview   = "waiting_code_review",
  CodeReviewRequested = "code_review_requested",
  Reviewing           = "reviewing",
  ChangesRequested    = "changes_requested",
  Approved            = "approved",
  Merging             = "merging",
  Merged              = "merged",
  Complete            = "complete",
  Canceled            = "canceled",
}
```

**Mapping**: The spec doc calls `plan_requested` → "New" (initial state when `requiresPlan=true`). `ready_for_code` is the initial state when `requiresPlan=false`.

### 4.2 Task Interface

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier |
| `title` | `string` | Short human-readable title |
| `description` | `string \| null` | Detailed explanation |
| `steerDetails` | `string \| null` | Implementation guidance / technical recommendations |
| `guardrails` | `string[]` | Behavioral constraints for agents, serialized as JSON |
| `acceptanceCriteria` | `string[]` | Conditions for completion, serialized as JSON |
| `priority` | `number` | Higher = more urgent |
| `recommendedBranch` | `string` | Suggested branch name |
| `realBranch` | `string \| null` | Actual branch used during implementation |
| `requiresPlan` | `boolean` | Whether planning step required (immutable after creation) |
| `mergeBranch` | `string` | Target merge branch (default `"develop"`) |
| `status` | `TaskStatus` | Current lifecycle state |
| `assignedAgent` | `AgentReference \| null` | JSON: `{ name, tool, model }` |
| `conversation` | `ConversationEntry[]` | Chronological messages (deprecated — use `conversation_entries` table) |
| `history` | `StatusHistoryEntry[]` | Status transitions (deprecated — use `status_history` table) |
| `contexts` | `string[]` | Agent-provided context snippets |
| `projectId` | `string \| null` | FK to projects |
| `worktreePath` | `string \| null` | Git worktree path for code changes |
| `createdAt` | `string` (ISO 8601) | Creation timestamp |
| `updatedAt` | `string` (ISO 8601) | Last update timestamp |
| `deletedAt` | `string \| null` | Soft delete timestamp |

**ConversationEntry**: `{ authorName: string, timestamp: string, message: string, messageType?: "user" | "agent" | "plan" | "code" | "review" | "merge" | "system" }`

**StatusHistoryEntry**: `{ pre_status: string, new_status: string, timestamp: string }`

**AgentReference**: `{ name: string, tool: string, model: string }`

### 4.3 Agent Interface

| Field | Type | Description |
|---|---|---|
| `id` | `string` | `<normalizedTool>@<version>\|<model>` (e.g. `opencode@1.2.1\|gpt-4`) |
| `toolName` | `string` | Human-readable name (e.g. "github copilot") |
| `version` | `string` | Tool version (e.g. "1.2.1") |
| `model` | `string` | Model identifier (e.g. "gpt-4") |
| `role` | `string` | `planner` \| `implementer` \| `reviewer` \| `senior` \| `architect` |
| `sessionId` | `string` | Session UUID (new on each agent run) |
| `host` | `string \| null` | Hostname or path |
| `startedAt` | `string \| null` | Session start timestamp |
| `lastSeen` | `string \| null` | Last activity timestamp |
| `deletedAt` | `string \| null` | Soft delete |

**ID normalization**: lowercase tool name, replace spaces with hyphens, then `<normalized>@<version>|<model>`.
Example: `github copilot@1.2.1|raptor` → `github-copilot@1.2.1|raptor`

### 4.4 Project Interface

| Field | Type | Description |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier |
| `displayName` | `string` | Human-readable name |
| `workingDirectory` | `string` | Absolute path to repository |
| `createdAt` | `string` | ISO timestamp |
| `updatedAt` | `string` | ISO timestamp |
| `deletedAt` | `string \| null` | Soft delete |

### 4.5 ActivityEvent Interface

```typescript
interface ActivityEvent {
  id: number;        // auto-increment primary key
  eventType: string; // e.g. "task_created", "plan_submitted", "code_approved"
  taskId: string;    // FK → tasks
  actor: string | null;
  details: string | null;
  createdAt: string; // ISO 8601
}
```

---

## 5. Database Schema (SQLite via `bun:sqlite`)

- **File path**: `~/agentq/agentq.db` (configurable via `AGENTQ_DB_PATH` env var, supports `~` expansion)
- **Connection**: Lazily initialized singleton with `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`

### Tables

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  version TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL,
  session_id TEXT NOT NULL,
  host TEXT,
  started_at TEXT,
  last_seen TEXT,
  deleted_at TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  steer_details TEXT,
  guardrails TEXT DEFAULT '[]',
  acceptance_criteria TEXT DEFAULT '[]',
  priority INTEGER DEFAULT 0,
  recommended_branch TEXT DEFAULT '',
  real_branch TEXT,
  requires_plan INTEGER DEFAULT 0,
  merge_branch TEXT DEFAULT 'develop',
  status TEXT NOT NULL DEFAULT 'plan_requested',
  assigned_agent_id TEXT,        -- JSON string: { name, tool, model }
  conversation TEXT DEFAULT '[]', -- JSON array (deprecated)
  history TEXT DEFAULT '[]',      -- JSON array (deprecated)
  contexts TEXT DEFAULT '[]',     -- JSON array of strings
  project_id TEXT REFERENCES projects(id),
  worktree_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  actor TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  author_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'user'
);

CREATE TABLE status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  pre_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
```

### Indexes (Migration 002)

```sql
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_deleted_at ON tasks(deleted_at);
CREATE INDEX idx_projects_deleted_at ON projects(deleted_at);
CREATE INDEX idx_agents_deleted_at ON agents(deleted_at);
CREATE INDEX idx_activity_task_id ON activity(task_id);
CREATE INDEX idx_activity_created_at ON activity(created_at);
CREATE INDEX idx_conv_task_id ON conversation_entries(task_id);
CREATE INDEX idx_history_task_id ON status_history(task_id);
```

### Migration System

- Uses `_migrations` table to track which migrations have been applied
- `isMigrationApplied(name)`, `markMigrationApplied(name)`, `getMigrationStatus()`, `rollbackMigration(name?)` functions

| # | Name | Description |
|---|---|---|
| 1 | `001_add_deleted_at` | Add `deleted_at` TEXT columns to tasks, projects, agents |
| 2 | `002_add_indexes` | Create all indexes listed above |
| 3 | `003_normalize_ready_for_code` | `UPDATE tasks SET status = 'ready_for_code' WHERE status = 'ready for code'` |
| 4 | `004_extract_conversation` | Extract JSON `conversation` → normalized `conversation_entries` table |
| 5 | `005_extract_history` | Extract JSON `history` → normalized `status_history` table |
| 6 | `006_add_steer_details_guardrails` | Add `steer_details` TEXT and `guardrails` TEXT DEFAULT '[]' columns |

---

## 6. Workflow

### 6.1 Task Status Lifecycle

```
plan_requested → planning → waiting_plan_review → ready_for_code
                                                        ↓
                                                    coding
                                                        ↓
                                              waiting_code_review
                                                ↓            ↓
                                     code_review_requested  approved
                                                ↓            ↓
                                            reviewing      merging
                                                ↓            ↓
                                         waiting_code     merged
                                           review           ↓
                                                         complete
```

`canceled` can be entered from ANY state. Arrow direction for `plan_changes_requested` and `changes_requested` are feedback loops.

### 6.2 Full Transition Table

| Current Status | Action | Next Status | Actor |
|---|---|---|---|
| `plan_requested` | Claim (planner) | `planning` | Agent |
| `planning` | Submit plan | `waiting_plan_review` | Agent |
| `waiting_plan_review` | Approve plan | `ready_for_code` | User |
| `waiting_plan_review` | Request plan changes | `plan_changes_requested` | User |
| `plan_changes_requested` | Claim (planner) | `planning` | Agent |
| `ready_for_code` | Claim (implementer) | `coding` | Agent |
| `coding` | Submit code | `waiting_code_review` | Agent |
| `changes_requested` | Claim (implementer) | `coding` | Agent |
| `waiting_code_review` | Approve code | `approved` | User |
| `waiting_code_review` | Request code changes | `changes_requested` | User |
| `waiting_code_review` | Request AI review | `code_review_requested` | User |
| `code_review_requested` | Claim (reviewer) | `reviewing` | Agent |
| `reviewing` | Submit review | `waiting_code_review` | Agent |
| `approved` | Claim (implementer) | `merging` | Agent |
| `merging` | Submit merge | `merged` | Agent |
| `merged` | Confirm completion | `complete` | User |
| Any active | Cancel | `canceled` | User |
| `planning` | Unblock | `plan_changes_requested` | User |
| `coding` | Unblock | `changes_requested` | User |
| `reviewing` | Unblock | `code_review_requested` | User |

**Cannot cancel**: `canceled`, `complete`, `merged` (protected by `CANCELED_CANT_CANCEL` set)
**Cannot hard-delete**: `coding` through `canceled` (protected by `CANT_DELETE_STATUSES` set)

### 6.3 Roles

| Role | Claimable Statuses | Transitions To |
|---|---|---|
| **planner** | `plan_requested`, `plan_changes_requested` | `planning` |
| **implementer** | `ready_for_code`, `changes_requested`, `approved` | `coding` (first two) or `merging` (`approved`) |
| **reviewer** | `code_review_requested` | `reviewing` |
| **senior** | All of the above (composite) | Delegates via `getEffectiveRole()` |
| **architect** | planner + reviewer (composite) | Delegates via `getEffectiveRole()` |

Compound roles (`senior`, `architect`) delegate to sub-roles based on task status via `getEffectiveRole()`.

### 6.4 User Actions (from Web UI)

- **Approve plan** — `waiting_plan_review` → `ready_for_code`
- **Request plan changes** — `waiting_plan_review` → `plan_changes_requested`
- **Approve code** — `waiting_code_review` → `approved`
- **Request code changes** — `waiting_code_review` → `changes_requested`
- **Request AI review** — `waiting_code_review` → `code_review_requested`
- **Unblock stuck task** — `planning`/`coding`/`reviewing` → revert to previous status, clears agent
- **Cancel task** — Any non-terminal state → `canceled`
- **Confirm completion** — `merged` → `complete`
- **Add comment** — Any state, appends to conversation

### 6.5 Agent Actions (CLI)

- **Claim** — Picks highest-priority eligible task for agent's role (priority DESC, createdAt ASC). Creates/updates agent. Transitions to working state.
- **Submit plan** — `planning` → `waiting_plan_review`. Adds conversation entry. Clears assigned agent.
- **Submit code** — `coding` → `waiting_code_review`. Requires `--worktree`. Adds conversation entry. Stores worktree path. Clears assigned agent.
- **Submit review** — `reviewing` → `waiting_code_review`. Adds conversation entry. Clears assigned agent.
- **Submit merge** — `merging` → `merged`. Requires branch, commit, authors. Adds conversation entry. Clears assigned agent.

**Rules:**
- Agents lose ownership after any submit (`assignedAgent` → `null`)
- Agents only claim unassigned tasks (`assignedAgent IS NULL` query)
- Context and conversation entries recorded on every action
- `requiresPlan` is immutable after creation

### 6.6 Board Column Mapping (Hardcoded)

| Column | Statuses |
|---|---|
| **Pending** | `plan_requested`, `ready_for_code`, `plan_changes_requested`, `code_review_requested`, `changes_requested`, `approved` |
| **In Progress** | `planning`, `coding`, `reviewing`, `merging` |
| **Need Review** | `waiting_plan_review`, `waiting_code_review` |
| **Done** | `complete`, `merged` |

---

## 7. Web Server (`packages/web/src/index.ts`)

Pure Bun HTTP server. Single file (~740 lines). Chained handler pattern with wrapped error handling.

**Default port**: 3000 (configurable via `PORT` env var).

### Modes

- **Production** — Serves built assets from `packages/web-ui/dist/`
- **Development** (`--dev` flag) — Spawns Vite dev server on port 5173, proxies non-API requests to it, adds CORS headers

### Handler Chain

```
handleOptions (CORS preflight)
→ handleSSE (/api/events GET)
→ handleGetAgents (/api/agents GET)
→ handleProjects (/api/projects GET/POST)
→ handleProjectById (/api/projects/:id PUT/DELETE)
→ handleActivity (/api/activity GET)
→ handleTasksList (/api/tasks GET)
→ handleCreateTask (/api/tasks POST)
→ handleTaskSubActions (/api/tasks/:id/:action POST)
→ handleTaskById (/api/tasks/:id GET/PUT/DELETE)
→ handleUnmatchedApi (404 for /api/*)
→ handleDevProxy (Vite proxy if --dev)
→ handleStatic (serve from dist/)
```

### REST API Endpoints

#### Tasks

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tasks` | List tasks (paginated). Query: `projectId`, `limit`, `offset` |
| `POST` | `/api/tasks` | Create task (validated with `createTaskSchema`) |
| `GET` | `/api/tasks/:id` | Get task by ID |
| `PUT` | `/api/tasks/:id` | Update task fields (validated with `updateTaskSchema`). Broadcasts SSE. |
| `DELETE` | `/api/tasks/:id` | Soft delete (default) or hard delete (`?hard=true`). Broadcasts SSE. |

**Task sub-actions** (all POST, validated with `transitionTaskSchema`):

| Path | Valid Status | Transitions To |
|---|---|---|
| `/api/tasks/:id/submit-plan` | `planning` | `waiting_plan_review` |
| `/api/tasks/:id/submit-code` | `coding` | `waiting_code_review` |
| `/api/tasks/:id/submit-review` | `reviewing` | `waiting_code_review` |
| `/api/tasks/:id/submit-merge` | `merging` | `merged` (requires `branch`, `commit`, `authors` in body) |
| `/api/tasks/:id/approve-plan` | `waiting_plan_review` | `ready_for_code` |
| `/api/tasks/:id/request-plan-changes` | `waiting_plan_review` | `plan_changes_requested` |
| `/api/tasks/:id/approve-code` | `waiting_code_review` | `approved` |
| `/api/tasks/:id/request-code-changes` | `waiting_code_review` | `changes_requested` |
| `/api/tasks/:id/request-ai-review` | `waiting_code_review` | `code_review_requested` |
| `/api/tasks/:id/confirm-completion` | `merged` | `complete` |
| `/api/tasks/:id/cancel` | Any non-terminal | `canceled` |
| `/api/tasks/:id/unblock` | `planning`/`coding`/`reviewing` | Depends on current |
| `/api/tasks/:id/add-comment` | Any | (no status change, adds conversation entry) |

Each action validates current task status, records history, adds conversation entry, clears assigned agent (where applicable), adds activity event, and broadcasts SSE.

#### Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/projects` | List all projects (no pagination) |
| `POST` | `/api/projects` | Create project (validated with `createProjectSchema`) |
| `PUT` | `/api/projects/:id` | Update project (validated with `updateProjectSchema`) |
| `DELETE` | `/api/projects/:id` | Soft delete (default) or hard delete (`?hard=true`) |

#### Agents

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agents` | List agents (paginated). Filters: `role`, `tool` |

#### Activity

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/activity` | List activity events (paginated). Filters: `taskId`, `agentId`, `from`, `to` |

#### Real-time Events

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/events` | SSE stream |

### SSE Implementation

- `Set<ReadableStreamDefaultController>` tracks connected clients
- 30-second keepalive heartbeat (`: keepalive\n\n`)
- Broadcasts two event types: `task_created` (full task JSON) and `task_updated` (updated task JSON)
- Cleans up disconnected clients on write error
- Client auto-removal on `req.signal` abort

### Pagination

- `paginationSchema`: `limit` (1-100, default 50) + `offset` (default 0)
- Returns `PaginatedResponse<T>`: `{ data: T[], total: number, limit: number, offset: number, hasMore: boolean }`
- Currently paginates in-memory (slice after fetch) — not SQL-level pagination

### Static File Serving

- Base path: `packages/web-ui/dist/`
- Immutable cache for `/assets/*` (1 year, `public, max-age=31536000`)
- SPA fallback: non-API routes serve `index.html`
- MIME types: `.html`, `.js`, `.css`, `.json`, `.svg`, `.png`, `.jpg`, `.webp`, `.woff2`, `.ttf`

---

## 8. CLI (`packages/cli/src/index.ts`)

Standalone binary named `agentq`, built with Commander (`^12`). Single file (~580 lines). The CLI operates directly on the SQLite database — no server needed.

### ALL Commands support `--json` flag

JSON success: `{ "success": true, ... }` | JSON error: `{ "success": false, "error": "..." }`

### `agentq list`
List all tasks with project info. Human-readable summary or `--json`.

### `agentq projects`
List all projects. Human-readable or `--json`.

### `agentq create <title>`
Create a new task.

| Option | Required | Description |
|---|---|---|
| `--project <id>` | Yes | Project ID (UUID) |
| `-d, --description <text>` | Yes | Task description |
| `--steer-details <text>` | No | Implementation guidance |
| `--guardrails <text>` | No | Pipe-separated constraints (`"r1\|r2"`) |
| `-p, --priority <number>` | No | Priority (default 0) |
| `-b, --branch <name>` | No | Recommended branch |
| `--requires-plan` | No | Requires planning phase |
| `--merge-branch <branch>` | No | Target merge branch (default `develop`) |
| `--context <text>` | No | Initial context entry |
| `-a, --acceptance-criteria <text>` | No | Pipe-separated criteria |
| `--json` | No | JSON output |

**Note**: The `--context` flag is passed to `createTask()` but the underlying function ignores extra keys — contexts are handled via separate `updateTask` calls in other commands.

### `agentq get <id>`
Get task by ID. Includes project object in JSON output.

### `agentq claim`
Claim highest-priority eligible task for agent's role.

| Option | Required | Description |
|---|---|---|
| `-n, --name <name>` | Yes | Agent name |
| `-v, --version <version>` | Yes | Agent version |
| `-m, --model <model>` | Yes | Model identifier |
| `-r, --role <role>` | Yes | `planner\|implementer\|reviewer\|senior\|architect` |
| `-s, --session-id <sessionId>` | Yes | Session UUID |
| `--host <host>` | No | Host path |
| `--context <text>` | No | Context entry |
| `--json` | No | JSON output |

**JSON response (success)**:
```json
{
  "success": true,
  "task": { "id": "...", "title": "...", "status": "...", "project": {...} },
  "agent": { "id": "opencode@1.0|gpt-4", "role": "implementer" }
}
```

**JSON response (no tasks)**:
```json
{
  "success": false,
  "reason": "no_tasks_available",
  "message": "No tasks available for your role."
}
```

Claim logic:
1. Resolves effective role via `getEffectiveRole()`
2. Determines claim transition via `getClaimTransition()`
3. Creates/updates agent (INSERT OR REPLACE in agents table)
4. Updates task status and assignedAgent
5. Records history and conversation entry
6. Appends context if provided

### `agentq submit-plan <taskId>`
Status: `planning` → `waiting_plan_review`. Options: `-m/--message`, `-a/--author` (default "agent"), `--context`, `--json`

### `agentq submit-code <taskId>`
Status: `coding` → `waiting_code_review`. Options: `-m/--message`, `-a/--author`, `-w/--worktree` **(required)**, `--context`, `--json`

### `agentq submit-review <taskId>`
Status: `reviewing` → `waiting_code_review`. Options: `-m/--message`, `-a/--author`, `--context`, `--json`

### `agentq submit-merge <taskId>`
Status: `merging` → `merged`. Options:

| Option | Required | Description |
|---|---|---|
| `-b, --branch <branch>` | Yes | Branch name |
| `-c, --commit <commit>` | Yes | Commit hash |
| `--authors <authors>` | Yes | Comma-separated author list |
| `-w, --worktree <worktree>` | No | Worktree path |
| `-m, --message <message>` | No | Additional details |
| `-a, --author <author>` | No | Author name (default "agent") |
| `--context <text>` | No | Context entry |
| `--json` | No | JSON output |

---

## 9. Web UI (`packages/web-ui/`)

React SPA with Vite build. Tailwind CSS for styling.

### Routes

| Route | Page Component | Description |
|---|---|---|
| `/` | Redirect → `/board` | |
| `/board` | BoardPage | Kanban board with 4 colored columns |
| `/tasks/:id/details` | TaskDetailPage | Full task detail with actions + tabs |
| `/tasks/:id` | BoardPage | Opens board with task highlight |
| `/agents` | AgentsPage | Agent list with filters |
| `/activity` | ActivityPage | Global activity timeline |
| `/projects` | ProjectsPage | Project CRUD |
| `/tools` | ToolsPage | Install tool cards |
| `/tools/install` | InstallToolPage | SSE-powered install UI |

### Pages

**BoardPage** (~190 lines):
- Top toolbar: search input, status filter, agent filter, project selector, "New Task" button
- 4 Kanban columns: Pending (gray), In Progress (blue), Need Review (yellow), Done (green)
- Each column shows task cards sorted by priority DESC then createdAt ASC
- Task cards clickable → navigate to detail page
- Pending/Need Review tasks show edit button
- Loading state: skeleton cards per column
- Create/Edit modals overlay

**TaskDetailPage** (~275 lines):
- Back button → board
- Header: title, status badge (color-coded), assigned agent
- Metadata grid: priority, branch, merge target, requires plan, worktree path
- Sections: description (markdown), steer details, guardrails (numbered list), acceptance criteria (checklist)
- Action buttons (conditionally shown based on status):
  - `waiting_plan_review`: Approve Plan, Request Changes
  - `waiting_code_review`: Approve Code, Request Changes, AI Review
  - `merged`: Confirm Complete
  - `planning`/`coding`/`reviewing`: Unblock
  - All active states: Cancel Task
- Feedback input field for action messages
- Tabs: Conversation (reverse chronological), History (timeline)
- Empty states for empty conversation/history

**AgentsPage**: Table with agent ID, tool, model, role, last seen, session. Filters by role/tool.

**ActivityPage**: Timeline-style feed. Filters by task, agent, date range.

**ProjectsPage**: CRUD for projects — create, edit, delete.

**ToolsPage**: Card grid for install tools (binary, skills, agents).

**InstallToolPage**: SSE-powered real-time install UI.

### Components (19 total)

| Component | Description |
|---|---|
| **Layout** | Sidebar nav (Board, Projects, Agents, Activity, Tools) + header "AgentQ — your 100x engineer tool" + theme toggle + main outlet |
| **TaskCard** | Card: title, priority badge, branch, status badge, assigned agent, plan/review badges, edit button |
| **CreateTaskModal** | Modal form: title, description, project, priority, branch, requiresPlan, mergeBranch, acceptance criteria, guardrails, steer details |
| **EditTaskModal** | Modal form for editing task fields |
| **DeleteTaskModal** | Confirmation dialog |
| **EditProjectModal** | Modal for project editing |
| **ConversationEntryCard** | Author avatar, metadata, markdown message body |
| **MarkdownRenderer** | `react-markdown` + `rehype-highlight` + `remark-gfm` |
| **ErrorBoundary** | React error boundary with "Try again" button |
| **Button** | Variants: `primary`, `secondary`, `danger`, `ghost` |
| **Badge** | Variants: `default`, `success`, `warning`, `danger`, `info`, `purple`. Supports `dot` prop. |
| **Input** | Styled text input |
| **Textarea** | Styled textarea |
| **Select** | Styled select dropdown |
| **Toggle** | Toggle switch |
| **Skeleton** | Loading placeholder |
| **LoadingSkeleton** | Full-page loading state |
| **ThemeToggle** | Sun/moon icons, toggles dark class on `<html>` |
| **EmptyState** | Icon + title + description + optional action |

### API Client (`lib/api.ts`)

Typed fetch wrapper. Base path: `/api`. Methods:

- `api.getTasks(projectId?)`, `api.getTask(id)`, `api.createTask(data)`, `api.updateTask(id, data)`, `api.deleteTask(id)`
- `api.submitPlan`, `api.submitCode`, `api.submitReview`, `api.submitMerge`
- `api.approvePlan`, `api.requestPlanChanges`, `api.approveCode`, `api.requestCodeChanges`, `api.requestAiReview`
- `api.confirmCompletion`, `api.cancel`, `api.unblock`, `api.addComment`
- `api.getAgents(filters?)`, `api.getProjects()`, `api.createProject`, `api.updateProject`, `api.deleteProject`
- `api.getActivity(filters?)`

All return typed responses. Error responses throw `Error` with the server's error message.

### SSE Hook (`hooks/useSSE.ts`)

- Connects to `/api/events` via `EventSource`
- Handles `task_created` and `task_updated` events
- Updates React Query cache directly (optimistic — no refetch): inserts new tasks, merges updated tasks
- Exponential backoff reconnect (1s → 30s cap)
- Cleanup on unmount

### Theme (`contexts/ThemeContext.tsx`)

- Light/dark mode toggle
- Persists to `localStorage` (key: `theme`)
- Toggles `dark` class on `<html>` element
- CSS variables control colors (defined in `index.css`)

### Key Dependencies (web-ui)

```
react ^19.1, react-dom ^19.1, react-router-dom ^7.6
@tanstack/react-query ^5.80
react-markdown ^10, rehype-highlight ^7, remark-gfm ^4
highlight.js ^11
focus-trap-react ^12
react-hot-toast ^2.6
tailwindcss ^3.4, vite ^6.3, @vitejs/plugin-react ^4.5
typescript ^5.8
```

---

## 10. Skills

### Shared Skills (`skills/` — installed to multiple agent tools)

**agentq-workflow/SKILL.md** (~250 lines):
- Identity info: `toolName`, `version`, `model`, `sessionId`, `role`
- CLI command reference with `--json` flags
- Phase intelligence table (task status → phase → action)
- Working directory per phase (project root for planning, worktree for coding/review/merge)
- Worktree management rules (create for coding+, skip for planning, use existing path)
- Path format: `{project}/.agentq/worktrees/{task.id}` (not `/tmp`)
- Git safety: NO commits until merging phase
- Message format templates (plan, code, review, merge)
- Context reading guidance (description, steerDetails, guardrails, acceptanceCriteria)
- Autonomy rules: DO NOT ask for permission
- Guardrails: DO NOT use `list`/`get`, DO NOT skip phases, DO NOT continue after submitting
- No-tasks-available handling

### OpenCode Skills (`.opencode/skills/`)

- `agentq-workflow/SKILL.md` — Adapted for OpenCode
- `agentq-create-task/SKILL.md` — Creating well-structured tasks via CLI
- 5 openspec skills: `openspec-apply-change`, `openspec-archive-change`, `openspec-explore`, `openspec-propose`, `openspec-sync-specs`

### Claude Skills (`.claude/skills/`)

- Same openspec skills (apply, archive, explore, sync) — minus propose

### OpenCode Commands (`.opencode/commands/`)

5 commands matching openspec skills (apply, archive, explore, propose, sync).

---

## 11. Agent Definitions

**`agents/opencode/agentq-fetcher.md`** — A subagent that:
- Claims the next eligible task from AgentQ using `agentq claim --json`
- Returns task details (does NOT implement or review)
- Uses `allowed-tools: Bash(agentq:*)` to restrict tool access

---

## 12. Installer (`packages/installer/`)

### `install-bin.ts` — Binary Installation

1. `bun build --compile` CLI source → `/tmp/agentq-binary`
2. Copy to `~/.local/bin/agentq`
3. `chmod 755`
4. Remove temp file
5. Verify with `agentq --version`
6. Check PATH (`echo $PATH`) and warn if `~/.local/bin` not in PATH

### `install-skills.ts` — Skill Installation

Copies `skills/agentq-workflow/SKILL.md` to all agent config directories:
- `~/.claude/skills/agentq-workflow/SKILL.md`
- `~/.config/opencode/skills/agentq-workflow/SKILL.md`
- `~/.codex/skills/agentq-workflow/SKILL.md`
- `~/.kimi-code/skills/agentq-workflow/SKILL.md`
- `~/.junie/skills/agentq-workflow/SKILL.md`

Creates target directories if missing.

### `install-agents.ts` — Agent Installation

Copies `agents/opencode/*.md` to `~/.config/opencode/agents/`

---

## 13. Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Web server port (validated: positive int, max 65535) |
| `AGENTQ_DB_PATH` | `~/agentq/agentq.db` | SQLite database path (`~` expanded to `homedir()`) |

### Agent ID Format

`<normalizedTool>@<version>|<model>`

Normalization: lowercase, replace spaces with hyphens.
Examples: `opencode@1.2.1|gpt-4`, `github-copilot@1.0|raptor`

### Worktree Path Convention

`<project-working-directory>/.agentq/worktrees/<task-id>`

Set by agent on `submit-code --worktree`. Stored in `task.worktreePath`.

---

## 14. Root Package.json

### Scripts

```json
{
  "start": "bun run --cwd packages/web-ui build && bun run packages/web/src/index.ts",
  "dev": "bun --watch run packages/web/src/index.ts --dev",
  "cli": "bun run packages/cli/src/index.ts",
  "install:bin": "bun run packages/installer/src/install-bin.ts",
  "install:skills": "bun run packages/installer/src/install-skills.ts",
  "install:agents": "bun run packages/installer/src/install-agents.ts",
  "lint": "eslint . --ext .ts,.tsx",
  "lint:fix": "eslint . --ext .ts,.tsx --fix",
  "format": "prettier --write \"packages/*/src/**/*.{ts,tsx,json,css,md}\"",
  "typecheck": "tsc --project packages/shared --noEmit && tsc --project packages/cli --noEmit && tsc --project packages/web --noEmit && tsc --project packages/web-ui --noEmit && tsc --project packages/installer --noEmit"
}
```

### Dev Dependencies (root)

```
typescript ^5.8.3
@typescript-eslint/eslint-plugin ^8.65
@typescript-eslint/parser ^8.65
eslint ^10.8, eslint-plugin-import ^2.32, eslint-plugin-react ^7.37, eslint-plugin-react-hooks ^7.1
prettier ^3.9
husky ^9.1, lint-staged ^17.2
```

---

## 15. Package Relationships

```
@agentq/shared        (zod, bun-types)
    ↑
@agentq/web           (shared → workspace:*)
@agentq/cli           (shared → workspace:*, commander ^12)
@agentq/web-ui        (shared → workspace:*, react, react-router, tanstack-query, vite, tailwind, etc.)
@agentq/installer     (no deps — uses bun $ and fs)
```

Bun workspace root `package.json` references `packages/*`.

---

## 16. Tests

**Location**: `packages/shared/src/database.test.ts`
**Runner**: `bun test` (Bun's built-in test runner)
**Database**: Uses in-memory SQLite (`AGENTQ_DB_PATH=:memory:`)

### Test Groups

1. **Database Isolation** — Verifies in-memory DB for tests
2. **getNextClaimableTask** — Tests priority ordering, status filtering, claimed-task exclusion, createdAt tiebreaker
3. **Soft Delete** — Tests soft/hard delete for tasks and projects, verifies exclusion from listings
4. **Workflow Refactor** — Tests `getClaimableStatuses`, `getClaimTransition`, `getEffectiveRole`, `normalizeStatusInput`, `normalizeStatus`
5. **Zod Validation Schemas** — Tests `createTaskSchema`, `transitionTaskSchema`, `createProjectSchema`, `paginationSchema`, `updateTaskSchema`
6. **Pagination Utilities** — Tests `paginate()` and `buildPaginationSql()`
7. **Transaction Wrapping** — Tests `withTransaction()` commit and rollback
8. **Env Validation** — Tests `validateEnv()` defaults
9. **Migration Status** — Tests `getMigrationStatus()`
10. **SteerDetails & Guardrails** — Tests creation, defaults, update, null-clearing, persistence
11. **Schema Validation — SteerDetails & Guardrails** — Tests Zod schemas with these fields
12. **Normalized Tables** — Tests `addConversationEntry`, `getConversationEntries`, `addStatusHistoryEntry`, `getStatusHistory`

---

## 17. Development Setup

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type checking (all packages)
bun run typecheck

# Linting
bun run lint

# Development mode (single port with Vite HMR + Bun auto-restart)
bun run dev

# Production mode
bun run start

# Run CLI directly (without compiling)
bun run cli <command>

# Install binary to PATH
bun run install:bin

# Install skills to all agent configs
bun run install:skills

# Install agent definitions
bun run install:agents
```

---

## 18. Key Architectural Decisions

1. **Bun's built-in SQLite** (`bun:sqlite`) — no external ORM. JSON columns for arrays, WAL mode for concurrent access.
2. **Normalized conversation/history tables** — migrated from JSON columns. New code writes to both normalized tables AND JSON columns for backward compatibility.
3. **Single-port architecture** — web server serves both API and static UI on port 3000. In dev, Vite runs on 5173 and is proxied.
4. **SSE for real-time** — lightweight, no WebSocket dependency. Two event types: `task_created`, `task_updated`.
5. **CLI works offline** — operates directly on SQLite, no server needed for agent operations.
6. **In-memory pagination** — current implementation fetches all rows then slices. Could be optimized to SQL-level LIMIT/OFFSET later.
7. **Composite roles** — `senior` and `architect` delegate to sub-roles via `getEffectiveRole()` rather than duplicating logic.
8. **Immutable requiresPlan** — cannot be changed after task creation. Determines initial status and workflow path.
9. **Soft delete by default** — hard delete requires explicit `?hard=true` flag. Deleted items excluded from queries via `WHERE deleted_at IS NULL`.
10. **Conversation authorName convention** — `"agentName|tool|model"` for agent messages so UI can parse both readable name and metadata.
11. **Local-first** — SQLite path defaults to `~/agentq/agentq.db`, supporting `~` expansion. Database is lazily initialized on first access.
12. **No HTTP from CLI** — the CLI imports shared code directly and calls database functions in-process. No network calls needed.

---

## 19. State Protection Sets

```typescript
// Statuses that cannot be canceled
CANCELED_CANT_CANCEL = new Set(["canceled", "complete", "merged"])

// Statuses that prevent hard-deletion (coding stage+)
CANT_DELETE_STATUSES = new Set([
  "coding", "waiting_code_review", "code_review_requested", "reviewing",
  "changes_requested", "approved", "merging", "merged", "complete", "canceled"
])
```

Tasks in `CANT_DELETE_STATUSES` respond with "Task has reached coding stage and cannot be deleted."

---

## 20. Additional Edge Cases & Notes

- **Server-side validation**: Each transition handler checks current status before proceeding. Returns descriptive error messages.
- **Submit-merge requirements**: Must include `branch`, `commit`, and `authors` in request body. Details are recorded in conversation as one line.
- **SSE keepalive**: Only runs when clients are connected. Stops when last client disconnects.
- **Agent auto-registration**: `claim` uses `INSERT OR REPLACE` — agents update their session on each claim.
- **Vite crash recovery**: In dev mode, Vite auto-restarts after 2s delay on non-zero exit.
- **Tasks in `plan_requested` or `plan_changes_requested` with `requiresPlan=false`**: Impossible by creation logic but migration handles legacy data via `normalizeStatus()`.
- **Legacy status `"ready for code"`** (spaces, not underscores): migration 003 normalizes it. Both `normalizeStatus()` and `normalizeStatusInput()` handle it as fallback.
