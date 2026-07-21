## MODIFIED Requirements

### Requirement: Create task
The system SHALL allow users to create new tasks with a title and description.

#### Scenario: Create task with title
- **WHEN** user provides a task title
- **THEN** system creates a new task with the provided title, sets status to PlanRequested, and returns the task object with generated ID

#### Scenario: Create task with title and description
- **WHEN** user provides a task title and description
- **THEN** system creates a new task with both fields, sets status to PlanRequested, and returns the complete task object
