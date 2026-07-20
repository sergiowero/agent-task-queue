# Task Management

Core CRUD operations for creating, reading, updating, and deleting tasks.

## MODIFIED Requirements

### Requirement: List tasks
The system SHALL allow users to retrieve a list of all tasks.
Tasks SHALL be ordered by priority descending by default, with equal-priority
tasks ordered by creation date ascending.

#### Scenario: List all tasks
- **WHEN** user requests task list
- **THEN** system returns tasks ordered by priority descending, with equal-priority tasks ordered by creation date ascending

#### Scenario: List tasks sorted by priority
- **WHEN** user requests task list
- **THEN** higher priority tasks appear before lower priority tasks
