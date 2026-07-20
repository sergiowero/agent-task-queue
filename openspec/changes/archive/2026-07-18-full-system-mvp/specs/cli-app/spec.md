## ADDED Requirements

### Requirement: Task list command
The system SHALL provide a CLI command to list all tasks.

#### Scenario: List tasks
- **WHEN** user runs `task-queue list`
- **THEN** system displays a formatted list of all tasks with IDs, titles, and statuses

### Requirement: Task create command
The system SHALL provide a CLI command to create a new task.

#### Scenario: Create task with title
- **WHEN** user runs `task-queue create "My Task"`
- **THEN** system creates a new task and displays the created task details

#### Scenario: Create task with description
- **WHEN** user runs `task-queue create "My Task" --description "Task details"`
- **THEN** system creates a new task with description and displays the created task details

### Requirement: Task get command
The system SHALL provide a CLI command to get a specific task.

#### Scenario: Get task by ID
- **WHEN** user runs `task-queue get <id>`
- **THEN** system displays the complete task details

### Requirement: Task update command
The system SHALL provide a CLI command to update a task.

#### Scenario: Update task status
- **WHEN** user runs `task-queue update <id> --status completed`
- **THEN** system updates the task status and displays the updated task

### Requirement: Task delete command
The system SHALL provide a CLI command to delete a task.

#### Scenario: Delete task
- **WHEN** user runs `task-queue delete <id>`
- **THEN** system deletes the task and displays confirmation message

### Requirement: Help command
The system SHALL provide built-in help for all commands.

#### Scenario: Show help
- **WHEN** user runs `task-queue --help` or `task-queue help`
- **THEN** system displays usage information for all available commands
