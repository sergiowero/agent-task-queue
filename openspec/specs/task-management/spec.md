# Task Management

Core CRUD operations for creating, reading, updating, and deleting tasks.

## Requirements

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

### Requirement: Conversation entries display
The system SHALL render conversation entry messages with markdown formatting support. Messages SHALL be parsed and displayed using a markdown renderer that supports common formatting elements including code blocks, lists, bold, italic, links, and headings. Plain text messages without markdown syntax SHALL render identically to previous behavior.

#### Scenario: Display formatted conversation entry
- **WHEN** a task conversation contains a message with markdown syntax
- **THEN** the message renders with proper formatting (bold, code blocks, lists, etc.)

#### Scenario: Display plain text conversation entry
- **WHEN** a task conversation contains a message without markdown syntax
- **THEN** the message renders as plain text with preserved whitespace, identical to previous behavior
