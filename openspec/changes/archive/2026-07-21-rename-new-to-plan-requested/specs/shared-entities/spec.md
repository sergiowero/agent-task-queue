## MODIFIED Requirements

### Requirement: Task status enum
The system SHALL define a TaskStatus enum with the following values: PlanRequested, Planning, WaitingPlanReview, PlanChangesRequested, Ready, Coding, WaitingCodeReview, CodeReviewRequested, Reviewing, ChangesRequested, Approved, Merging, Merged, Complete, Canceled.

#### Scenario: Valid status transitions
- **WHEN** a task status is updated
- **THEN** the new status is one of the defined TaskStatus values and the transition follows the workflow rules

#### Scenario: PlanRequested is the initial status
- **WHEN** a new task is created
- **THEN** its status is set to PlanRequested

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
  conversation TEXT DEFAULT '[]',
  history TEXT DEFAULT '[]',
  contexts TEXT DEFAULT '[]',
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

### Requirement: StatusHistoryEntry value object
The system SHALL define a StatusHistoryEntry type with fields: pre_status (string), new_status (string), timestamp (string).

#### Scenario: Status history entry has required fields
- **WHEN** a StatusHistoryEntry is created
- **THEN** it contains pre_status, new_status, and timestamp fields
