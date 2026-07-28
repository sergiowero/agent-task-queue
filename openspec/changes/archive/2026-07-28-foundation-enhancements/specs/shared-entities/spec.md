## MODIFIED Requirements

### Requirement: Task entity definition
The system SHALL define a Task entity with the following fields: id, title, description, acceptanceCriteria, priority, recommendedBranch, realBranch, requiresPlan, mergeBranch, status, assignedAgent, conversation, history, contexts, projectId, worktreePath, deletedAt, createdAt, updatedAt.

#### Scenario: Task has required fields
- **WHEN** a Task object is created
- **THEN** it contains id (string), title (string), description (string | null), acceptanceCriteria (string[]), priority (number), recommendedBranch (string), realBranch (string | null), requiresPlan (boolean), mergeBranch (string, default "develop"), status (TaskStatus), assignedAgent (AgentReference | null), conversation (ConversationEntry[]), history (StatusHistoryEntry[]), contexts (string[]), projectId (string), worktreePath (string | null), deletedAt (string | null), createdAt (string), updatedAt (string)

### Requirement: Task status enum normalization
The TaskStatus enum SHALL normalize `ReadyForCode` from `"ready for code"` to `"ready_for_code"`. The system SHALL accept both values in queries during a deprecation window.

#### Scenario: New tasks use normalized value
- **WHEN** a new task is created with `requiresPlan: false`
- **THEN** its status is `"ready_for_code"` (not `"ready for code"`)

#### Scenario: Backward compatibility
- **WHEN** querying tasks with status `"ready for code"` as filter
- **THEN** the system also returns tasks with status `"ready_for_code"` during deprecation window

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

## REMOVED Requirements

### Requirement: conversation field as JSON column
**Reason**: Replaced by normalized `conversation_entries` table
**Migration**: Existing JSON data in the `conversation` column is extracted into `conversation_entries` via migration script. The old column is kept as a fallback during transition.

### Requirement: history field as JSON column
**Reason**: Replaced by normalized `status_history` table
**Migration**: Existing JSON data in the `history` column is extracted into `status_history` via migration script. The old column is kept as a fallback during transition.

### Requirement: Delete task from database
**Reason**: Replaced by soft delete — `deleteTask` sets `deleted_at` instead of removing the row
**Migration**: Callers that need actual deletion should use `?hard=true` query parameter or explicit `actualDelete` flag

### Requirement: Delete project from database
**Reason**: Replaced by soft delete — `deleteProject` sets `deleted_at` instead of removing the row
**Migration**: Callers that need actual deletion should use `?hard=true` query parameter or explicit `actualDelete` flag
