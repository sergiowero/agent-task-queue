# Soft Delete

Soft delete support for projects, tasks, and agents with hard delete option via query parameter.

## Requirements

### Requirement: Soft delete for projects
Projects SHALL support soft delete via a `deleted_at` timestamp. By default, queries SHALL exclude soft-deleted records.

#### Scenario: Soft delete project
- **WHEN** calling `DELETE /api/projects/:id`
- **THEN** the project's `deleted_at` is set to the current timestamp and it is no longer returned by list queries

#### Scenario: Hard delete with query param
- **WHEN** calling `DELETE /api/projects/:id?hard=true`
- **THEN** the project is permanently deleted from the database

#### Scenario: List excludes deleted
- **WHEN** calling `GET /api/projects`
- **THEN** projects with non-null `deleted_at` are not included

### Requirement: Soft delete for tasks
Tasks SHALL support soft delete via a `deleted_at` timestamp.

#### Scenario: Soft delete task
- **WHEN** calling `DELETE /api/tasks/:id`
- **THEN** the task's `deleted_at` is set to the current timestamp

#### Scenario: Task list excludes deleted
- **WHEN** calling `GET /api/tasks`
- **THEN** tasks with non-null `deleted_at` are not included

### Requirement: Soft delete for agents
Agents SHALL support soft delete.

#### Scenario: Agent cleanup
- **WHEN** an agent has not been seen for a configurable period
- **THEN** a maintenance query can soft-delete stale agent records
