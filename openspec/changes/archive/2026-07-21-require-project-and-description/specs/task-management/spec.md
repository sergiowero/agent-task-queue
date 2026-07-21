## MODIFIED Requirements

### Requirement: Create task
The system SHALL allow users to create new tasks with a title, description, and project. Project and description are mandatory fields.

#### Scenario: Create task with all required fields
- **WHEN** user provides a task title, description, and project ID
- **THEN** system creates a new task with the provided fields, sets status to PlanRequested, and returns the task object with generated ID

#### Scenario: Create task without project
- **WHEN** user provides a task title but no project ID
- **THEN** system returns a 400 error indicating project is required

#### Scenario: Create task without description
- **WHEN** user provides a task title and project ID but no description
- **THEN** system returns a 400 error indicating description is required
