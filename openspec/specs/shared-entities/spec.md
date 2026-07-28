# Shared Entities

Common TypeScript types and database schemas shared across web and CLI.

## Requirements

### Requirement: Task entity definition
The system SHALL define a Task entity with the following fields: id, title, description, acceptanceCriteria, priority, recommendedBranch, realBranch, requiresPlan, mergeBranch, status, assignedAgent, conversation, history, contexts, projectId, worktreePath, deletedAt, createdAt, updatedAt.

#### Scenario: Task has required fields
- **WHEN** a Task object is created
- **THEN** it contains id (string), title (string), description (string | null), acceptanceCriteria (string[]), priority (number), recommendedBranch (string), realBranch (string | null), requiresPlan (boolean), mergeBranch (string, default "develop"), status (TaskStatus), assignedAgent (AgentReference | null), conversation (ConversationEntry[]), history (StatusHistoryEntry[]), contexts (string[]), projectId (string), worktreePath (string | null), deletedAt (string | null), createdAt (string), updatedAt (string)

#### Scenario: Task has conversation thread
- **WHEN** a Task object is created
- **THEN** the conversation field is an empty array

#### Scenario: Task has status history
- **WHEN** a Task object is created
- **THEN** the history field is an empty array

#### Scenario: Task has context snippets
- **WHEN** a Task object is created
- **THEN** the contexts field is an empty array

### Requirement: Task status enum normalization
The TaskStatus enum SHALL normalize `ReadyForCode` from `"ready for code"` to `"ready_for_code"`. The system SHALL accept both values in queries during a deprecation window.

#### Scenario: New tasks use normalized value
- **WHEN** a new task is created with `requiresPlan: false`
- **THEN** its status is `"ready_for_code"` (not `"ready for code"`)

#### Scenario: Backward compatibility
- **WHEN** querying tasks with status `"ready for code"` as filter
- **THEN** the system also returns tasks with status `"ready_for_code"` during deprecation window

### Requirement: Task status enum
The system SHALL define a TaskStatus enum with the following values: PlanRequested, Planning, WaitingPlanReview, PlanChangesRequested, ReadyForCode, Coding, WaitingCodeReview, CodeReviewRequested, Reviewing, ChangesRequested, Approved, Merging, Merged, Complete, Canceled.

#### Scenario: Valid status transitions
- **WHEN** a task status is updated
- **THEN** the new status is one of the defined TaskStatus values and the transition follows the workflow rules

#### Scenario: PlanRequested is the initial status
- **WHEN** a new task is created
- **THEN** its status is set to PlanRequested

### Requirement: Soft delete field on entities
Projects, tasks, and agents SHALL include an optional `deletedAt` timestamp field. Queries SHALL exclude soft-deleted records by default.

#### Scenario: Projects table with deleted_at
- **WHEN** querying the projects table with default list
- **THEN** only rows WHERE `deleted_at IS NULL` are returned

#### Scenario: Tasks table with deleted_at
- **WHEN** querying tasks with default list
- **THEN** only tasks WHERE `deleted_at IS NULL` are returned

### Requirement: Database schema with indexes
The system SHALL include indexes on foreign key columns and commonly queried fields.

#### Schema: Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_activity_task_id ON activity(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at);
```

### Requirement: Database schema with soft delete columns
The tasks, projects, and agents tables SHALL include a `deleted_at TEXT` column.

#### Schema: Modified tasks table
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  -- ... existing columns ...
  deleted_at TEXT,
  -- ... remaining columns ...
);
```

### Requirement: Database schema with normalized tables
Conversation entries and status history SHALL be stored in separate normalized tables.

#### Schema: conversation_entries table
```sql
CREATE TABLE IF NOT EXISTS conversation_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'agent',
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conv_task_id ON conversation_entries(task_id);
```

#### Schema: status_history table
```sql
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  pre_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_history_task_id ON status_history(task_id);
```

### Requirement: Database schema
The system SHALL provide a SQLite schema for persisting tasks, agents, and projects.

#### Schema: tasks table
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  acceptance_criteria TEXT DEFAULT '[]',
  priority INTEGER DEFAULT 0,
  recommended_branch TEXT DEFAULT '',
  real_branch TEXT,
  requires_plan INTEGER DEFAULT 0,
  merge_branch TEXT DEFAULT 'develop',
  status TEXT NOT NULL DEFAULT 'plan_requested',
  assigned_agent_id TEXT,
  contexts TEXT DEFAULT '[]',
  project_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

#### Schema: agents table
```sql
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
```

#### Schema: projects table
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### Schema: activity table
```sql
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  task_id TEXT NOT NULL,
  actor TEXT,
  details TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### Requirement: ConversationEntry value object
The system SHALL define a ConversationEntry type with fields: authorName (string), timestamp (string), message (string).

#### Scenario: Conversation entry has required fields
- **WHEN** a ConversationEntry is created
- **THEN** it contains authorName, timestamp, and message fields

#### Scenario: Agent author name format
- **WHEN** an agent creates a conversation entry
- **THEN** authorName follows the format `<agentName>|<tool>|<model>`

### Requirement: StatusHistoryEntry value object
The system SHALL define a StatusHistoryEntry type with fields: pre_status (string), new_status (string), timestamp (string).

#### Scenario: Status history entry has required fields
- **WHEN** a StatusHistoryEntry is created
- **THEN** it contains pre_status, new_status, and timestamp fields

### Requirement: Database operations
The system SHALL provide CRUD operations for tasks, agents, and projects that work with SQLite.

#### Scenario: Create task in database
- **WHEN** createTask is called with task data
- **THEN** a new row is inserted into the tasks table and the complete task is returned

#### Scenario: Read tasks from database
- **WHEN** getTasks is called
- **THEN** all rows from the tasks table are returned as Task objects

#### Scenario: Read tasks filtered by project
- **WHEN** getTasks is called with a projectId filter
- **THEN** only rows matching the project_id are returned

#### Scenario: Update task in database
- **WHEN** updateTask is called with ID and changes
- **THEN** the corresponding row is updated and the complete task is returned

#### Scenario: Soft delete task from database
- **WHEN** deleteTask is called with ID without hard flag
- **THEN** deleted_at is set instead of removing the row

#### Scenario: Hard delete task from database
- **WHEN** deleteTask is called with ID and hard flag
- **THEN** the corresponding row is removed from the tasks table

#### Scenario: Create agent in database
- **WHEN** createAgent is called with agent data
- **THEN** a new row is inserted into the agents table and the agent is returned

#### Scenario: Get agent by ID
- **WHEN** getAgentById is called with a valid ID
- **THEN** the corresponding agent row is returned

#### Scenario: Update agent last seen
- **WHEN** updateAgentLastSeen is called with an agent ID
- **THEN** the agent's last_seen field is updated to the current timestamp

#### Scenario: List agents
- **WHEN** getAgents is called
- **THEN** all rows from the agents table are returned

#### Scenario: Create project in database
- **WHEN** createProject is called with project data
- **THEN** a new row is inserted into the projects table and the project is returned

#### Scenario: List projects
- **WHEN** getProjects is called
- **THEN** all rows from the projects table are returned

#### Scenario: Soft delete project from database
- **WHEN** deleteProject is called with ID without hard flag
- **THEN** deleted_at is set instead of removing the row

#### Scenario: Hard delete project from database
- **WHEN** deleteProject is called with ID and hard flag
- **THEN** the corresponding row is removed from the projects table
