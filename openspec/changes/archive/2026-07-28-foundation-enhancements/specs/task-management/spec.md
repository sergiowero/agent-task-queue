## MODIFIED Requirements

### Requirement: List tasks with pagination
The system SHALL allow users to retrieve a paginated list of tasks. The response SHALL include a `total` count and support `limit` (default 50) and `offset` query parameters.
Tasks SHALL be ordered by priority descending by default, with equal-priority tasks ordered by creation date ascending.

#### Scenario: List all tasks with pagination
- **WHEN** user requests task list with `GET /api/tasks?limit=10&offset=0`
- **THEN** system returns at most 10 tasks, plus a `total` field indicating the total count of matching tasks

#### Scenario: List tasks sorted by priority
- **WHEN** user requests task list
- **THEN** higher priority tasks appear before lower priority tasks, paginated

#### Scenario: Default pagination values
- **WHEN** user requests `GET /api/tasks` without pagination params
- **THEN** system uses default limit=50, offset=0

### Requirement: Delete task with soft delete
The system SHALL soft-delete a task by setting its `deleted_at` timestamp. A `?hard=true` query parameter SHALL perform actual deletion.

#### Scenario: Soft delete existing task
- **WHEN** user requests DELETE /api/tasks/:id
- **THEN** system sets deleted_at and returns 204 (row is preserved)

#### Scenario: Hard delete existing task
- **WHEN** user requests DELETE /api/tasks/:id?hard=true
- **THEN** system permanently removes the task and returns 204

#### Scenario: Delete non-existent task
- **WHEN** user requests deletion of an invalid task ID
- **THEN** system returns a 404 error
