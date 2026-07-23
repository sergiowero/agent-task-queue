# CLI App

Command-line interface for managing tasks via terminal.

## Purpose

Provide a command-line interface for agents and users to create, list, claim, and manage AgentQ tasks.
## Requirements
### Requirement: Task list command
The system SHALL provide a CLI command to list all tasks.

#### Scenario: List tasks
- **WHEN** user runs `task-queue list`
- **THEN** system displays a formatted list of all tasks with IDs, titles, and statuses

### Requirement: Task create command
The system SHALL provide a CLI command to create a new task. The `--project` and `--description` flags are mandatory.

#### Scenario: Create task with all required fields
- **WHEN** user runs `agentq create "My Task" --project <project-id> --description "Task details"`
- **THEN** system creates a new task with all provided fields and displays the created task details including project name and displayName

#### Scenario: Create task without project
- **WHEN** user runs `agentq create "My Task"` without `--project`
- **THEN** system returns an error indicating `--project` is required

#### Scenario: Create task without description
- **WHEN** user runs `agentq create "My Task" --project <project-id>` without `--description`
- **THEN** system returns an error indicating `--description` is required

#### Scenario: Create task with merge branch
- **WHEN** user runs `agentq create "My Task" --project <project-id> --description "Details" --merge-branch main`
- **THEN** system creates a task with merge_branch set to "main"

### Requirement: Task output includes project details
The system SHALL include complete project details (name, displayName, workingDirectory) in all CLI command outputs that return task data, both in text and JSON format.

#### Scenario: Text output shows project
- **WHEN** any CLI command outputs a task in text format
- **THEN** the output includes the project name and displayName

#### Scenario: JSON output includes project object
- **WHEN** any CLI command outputs a task in JSON format with `--json`
- **THEN** the JSON includes a `project` object with id, name, displayName, and workingDirectory

### Requirement: Task get command
The system SHALL provide a CLI command to get a specific task.

#### Scenario: Get task by ID
- **WHEN** user runs `task-queue get <id>`
- **THEN** system displays the complete task details

### Requirement: Help command
The system SHALL provide built-in help for all commands.

#### Scenario: Show help
- **WHEN** user runs `task-queue --help` or `task-queue help`
- **THEN** system displays usage information for all available commands

### Requirement: Task claim command
The system SHALL provide a CLI command `atq claim` that accepts agent identity arguments and automatically selects the highest-priority eligible task.

#### Scenario: Claim task with all required arguments
- **WHEN** user runs `atq claim --name agent-1 --version 1.0 --model gpt-4 --role planner --session-id abc123`
- **THEN** system auto-selects and claims the highest-priority eligible task, outputs task details, and shows the new status

#### Scenario: Claim task with short flag names
- **WHEN** user runs `atq claim -n agent-1 -v 1.0 -m gpt-4 -r planner -s abc123`
- **THEN** system behaves identically to long flag names

#### Scenario: Claim with no available tasks
- **WHEN** user runs `atq claim` with valid arguments but no tasks are available
- **THEN** system displays "No tasks available for your role" message

### Requirement: Task submit-plan command
The system SHALL provide a CLI command `atq submit-plan` that submits a plan for a claimed task.

#### Scenario: Submit plan for a task
- **WHEN** user runs `atq submit-plan <task-id> --message "Plan content"`
- **THEN** system transitions the task from Planning to Waiting Plan Review, clears the assigned agent, and outputs confirmation

### Requirement: Task submit-code command
The system SHALL provide a CLI command `atq submit-code` that submits code for a claimed task.

#### Scenario: Submit code for a task
- **WHEN** user runs `atq submit-code <task-id> --message "Code summary"`
- **THEN** system transitions the task from Coding to Waiting Code Review, clears the assigned agent, and outputs confirmation

### Requirement: Task submit-review command
The system SHALL provide a CLI command `atq submit-review` that submits a review for a claimed task.

#### Scenario: Submit review for a task
- **WHEN** user runs `atq submit-review <task-id> --message "Review findings"`
- **THEN** system transitions the task from Reviewing to Waiting Code Review, clears the assigned agent, and outputs confirmation

### Requirement: Task submit-merge command
The system SHALL provide a CLI command `atq submit-merge` that submits a merge for a claimed task. The merge confirmation must include branch name, commit hash, and authors. Worktree path is optional.

#### Scenario: Submit merge for a task
- **WHEN** user runs `atq submit-merge <task-id> --branch feature/x --commit abc123 --authors "agent-1,user"`
- **THEN** system transitions the task from Merging to Merged, clears the assigned agent, stores merge details in the conversation, and outputs confirmation

#### Scenario: Submit merge with worktree
- **WHEN** user runs `atq submit-merge <task-id> --branch feature/x --commit abc123 --worktree /tmp/ohxeng-123 --authors "agent-1"`
- **THEN** system records the worktree path along with branch, commit, and authors in the conversation entry

### Requirement: Project list command
The system SHALL provide a CLI command to list all registered projects.

#### Scenario: List projects
- **WHEN** user runs `agentq projects`
- **THEN** system displays a formatted list of all projects with IDs, display names, and working directories

#### Scenario: List projects as JSON
- **WHEN** user runs `agentq projects --json`
- **THEN** system outputs JSON array with id, displayName, workingDirectory for each project

