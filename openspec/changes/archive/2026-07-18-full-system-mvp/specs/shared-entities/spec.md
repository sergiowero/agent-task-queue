## ADDED Requirements

### Requirement: Task entity definition
The system SHALL define a Task entity with the following fields: id, title, description, status, createdAt, updatedAt.

#### Scenario: Task has required fields
- **WHEN** a Task object is created
- **THEN** it contains id (string), title (string), description (string | null), status (TaskStatus), createdAt (Date), updatedAt (Date)

### Requirement: Task status enum
The system SHALL define a TaskStatus enum with values: pending, in_progress, completed, cancelled.

#### Scenario: Valid status transitions
- **WHEN** a task status is updated
- **THEN** the new status is one of: pending, in_progress, completed, cancelled

### Requirement: Database schema
The system SHALL provide a SQLite schema for persisting tasks.

#### Schema: tasks table
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Requirement: Database operations
The system SHALL provide CRUD operations for tasks that work with SQLite.

#### Scenario: Create task in database
- **WHEN** createTask is called with task data
- **THEN** a new row is inserted into the tasks table and the complete task is returned

#### Scenario: Read tasks from database
- **WHEN** getTasks is called
- **THEN** all rows from the tasks table are returned as Task objects

#### Scenario: Update task in database
- **WHEN** updateTask is called with ID and changes
- **THEN** the corresponding row is updated and the complete task is returned

#### Scenario: Delete task from database
- **WHEN** deleteTask is called with ID
- **THEN** the corresponding row is removed from the tasks table
