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
The system SHALL provide a CLI command `atq submit-code` that submits code for a claimed task. The `--worktree` flag SHALL be required via Commander's `.requiredOption()`.

#### Scenario: Submit code for a task
- **WHEN** user runs `atq submit-code <task-id> --message "Code summary" --worktree /tmp/worktree`
- **THEN** system transitions the task from Coding to Waiting Code Review, clears the assigned agent, stores the worktree path, and outputs confirmation

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

### Requirement: Required option enforcement
Options that are required SHALL use Commander's `.requiredOption()` method.

#### Scenario: submit-code worktree is required
- **WHEN** user runs `atq submit-code <task-id>` without `--worktree`
- **THEN** Commander outputs "error: required option '-w, --worktree <path>' not specified" before the action runs

### Requirement: Typed command options
All CLI command action handlers SHALL use typed interfaces for options instead of inline `any` types.

#### Scenario: Options are typed
- **WHEN** a CLI command action is defined
- **THEN** the options parameter has a named TypeScript interface with typed fields

### Requirement: JSON error output to stderr
When `--json` is active and an error occurs, the error JSON SHALL be written to stderr.

#### Scenario: JSON error on stderr
- **WHEN** a command with `--json` encounters an error
- **THEN** the error JSON `{ "success": false, "error": "..." }` is written to stderr and process exits with code 1

### Requirement: Claim command accepts --context
The `atq claim` command SHALL accept an optional `--context <text>` flag. When provided, the context string is appended to the task's `contexts` array.

#### Scenario: Claim with context
- **WHEN** user runs `atq claim -n agent-1 -v 1.0 -m gpt-4 -r planner -s abc123 --context "Starting planning"`
- **THEN** the context entry "Starting planning" is appended to the task's contexts array

#### Scenario: Claim without context
- **WHEN** user runs `atq claim -n agent-1 -v 1.0 -m gpt-4 -r planner -s abc123` without `--context`
- **THEN** the contexts array is unchanged

### Requirement: Submit commands accept --context
The `atq submit-plan`, `atq submit-code`, `atq submit-review`, and `atq submit-merge` commands SHALL accept an optional `--context <text>` flag. When provided, the context string is appended to the task's `contexts` array alongside the conversation entry.

#### Scenario: Submit plan with context
- **WHEN** user runs `atq submit-plan <task-id> --message "Plan details" --context "Found existing auth module, will reuse"`
- **THEN** the context entry is appended, and the conversation entry is created as before

#### Scenario: Submit code with context
- **WHEN** user runs `atq submit-code <task-id> --message "Done" --worktree /tmp/x --context "Tests passing, one flaky test noted"`
- **THEN** the context entry is appended

#### Scenario: Submit review with context
- **WHEN** user runs `atq submit-review <task-id> --message "LGTM" --context "Minor nits on naming, otherwise solid"`
- **THEN** the context entry is appended

#### Scenario: Submit merge with context
- **WHEN** user runs `atq submit-merge <task-id> -b feat/x -c abc123 --authors "bot" --context "Deployed to staging first"`
- **THEN** the context entry is appended

#### Scenario: Submit without context
- **WHEN** user runs any submit command without `--context`
- **THEN** the contexts array is unchanged

### Requirement: Create command accepts --context
The `agentq create` command SHALL accept an optional `--context <text>` flag to seed the initial context entry.

#### Scenario: Create task with context
- **WHEN** user runs `agentq create "My Task" --project <id> --description "Details" --context "Spike: evaluate approach"`
- **THEN** the task is created with one context entry

### Requirement: Task output includes contexts in printTask
The `printTask` helper SHALL display context entries when non-empty.

#### Scenario: printTask shows context entries
- **WHEN** a task with context entries is printed via `printTask`
- **THEN** the output includes a `Context:` section with numbered entries

#### Scenario: printTask omits context when empty
- **WHEN** a task with no context entries is printed
- **THEN** no context section is shown

