# Database Optimization

SQLite indexes, transaction support, and normalized table structure for improved database performance and integrity.

## Requirements

### Requirement: SQLite indexes on foreign keys
The database SHALL have indexes on all foreign key columns used in JOINs and WHERE clauses.

#### Scenario: Project index
- **WHEN** querying tasks by project_id
- **THEN** the query uses the `idx_tasks_project_id` index

#### Scenario: Activity indexes
- **WHEN** querying activity by task_id or ordering by created_at
- **THEN** the query uses available indexes

### Requirement: Transactions for multi-step operations
Workflow transition endpoints SHALL use SQLite transactions when performing multiple writes in a single request.

#### Scenario: Submit plan is atomic
- **WHEN** submit-plan is called (history + conversation + task update + activity)
- **THEN** all writes happen in a single transaction; failure rolls back all changes

### Requirement: Normalized conversation table
Conversation entries SHALL be stored in a separate `conversation_entries` table instead of a JSON column.

#### Scenario: Conversation migration
- **WHEN** the database migrates
- **THEN** existing JSON conversation data is extracted into the new table

#### Scenario: Conversation added
- **WHEN** a conversation entry is created
- **THEN** it is inserted as a row in `conversation_entries` with FK to the task

### Requirement: Normalized history table
Status history entries SHALL be stored in a separate `status_history` table instead of a JSON column.

#### Scenario: History migration
- **WHEN** the database migrates
- **THEN** existing JSON history data is extracted into the new table

### Requirement: Static analysis indexes
The database SHALL have a `created_at` index on the activity table for efficient time-based queries.

#### Scenario: Activity time queries are fast
- **WHEN** querying activity with date range filters
- **THEN** the query uses the `idx_activity_created_at` index
