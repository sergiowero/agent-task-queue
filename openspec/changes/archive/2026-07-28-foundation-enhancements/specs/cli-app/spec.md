## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Task submit-code command
The system SHALL provide a CLI command `atq submit-code` that submits code for a claimed task. The `--worktree` flag SHALL be required via Commander's `.requiredOption()`.

#### Scenario: Submit code with required worktree
- **WHEN** user runs `atq submit-code <task-id> --message "Code summary" --worktree /tmp/worktree`
- **THEN** system transitions the task from Coding to Waiting Code Review, clears the assigned agent, stores the worktree path, and outputs confirmation
