## ADDED Requirements

### Requirement: Create task
The system SHALL allow users to create new tasks with a title and description.

#### Scenario: Create task with title
- **WHEN** user provides a task title
- **THEN** system creates a new task with the provided title and returns the task object with generated ID

#### Scenario: Create task with title and description
- **WHEN** user provides a task title and description
- **THEN** system creates a new task with both fields and returns the complete task object

### Requirement: List tasks
The system SHALL allow users to retrieve a list of all tasks.

#### Scenario: List all tasks
- **WHEN** user requests task list
- **THEN** system returns an array of all tasks with their current status

### Requirement: Get task by ID
The system SHALL allow users to retrieve a specific task by its ID.

#### Scenario: Get existing task
- **WHEN** user requests a task with a valid ID
- **THEN** system returns the complete task object

#### Scenario: Get non-existent task
- **WHEN** user requests a task with an invalid ID
- **THEN** system returns a 404 error

### Requirement: Update task
The system SHALL allow users to update an existing task's title, description, or status.

#### Scenario: Update task status
- **WHEN** user provides a valid task ID and new status
- **THEN** system updates the task's status and returns the updated task object

#### Scenario: Update task details
- **WHEN** user provides a valid task ID and new title/description
- **THEN** system updates the task fields and returns the updated task object

### Requirement: Delete task
The system SHALL allow users to delete a task by its ID.

#### Scenario: Delete existing task
- **WHEN** user requests deletion of a valid task ID
- **THEN** system removes the task and returns confirmation

#### Scenario: Delete non-existent task
- **WHEN** user requests deletion of an invalid task ID
- **THEN** system returns a 404 error
