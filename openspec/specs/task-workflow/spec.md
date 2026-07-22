# Task Workflow

Workflow rules for task execution, worktree management, and UI display.

## Requirements

### Requirement: Worktree is mandatory for code submission
The system SHALL require a worktree path when submitting code. The `submit-code` command SHALL reject submissions without a `--worktree` flag.

#### Scenario: Submit code with worktree
- **WHEN** agent runs `atq submit-code <taskId> --worktree /path/to/worktree -m "message"`
- **THEN** system accepts the submission and stores the worktree path

#### Scenario: Submit code without worktree
- **WHEN** agent runs `atq submit-code <taskId> -m "message"` without `--worktree`
- **THEN** system rejects with error "worktree path is required"

### Requirement: Worktree path stored inside project
The system SHALL store worktree paths at `.atq/worktrees/{taskId}` inside the project directory.

#### Scenario: Worktree path format
- **WHEN** agent creates a worktree for task `abc-123` in project `/path/to/project`
- **THEN** worktree path is `/path/to/project/.atq/worktrees/abc-123`

### Requirement: Task details display worktree path
The task details UI SHALL display the worktree path when available.

#### Scenario: Worktree path visible in task details
- **WHEN** user opens task details for a task with a worktree assigned
- **THEN** worktree path is displayed in the summary tab

#### Scenario: No worktree assigned
- **WHEN** user opens task details for a task without a worktree
- **THEN** worktree field shows "—"
