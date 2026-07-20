## MODIFIED Requirements

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
The system SHALL provide a CLI command `atq submit-merge` that submits a merge for a claimed task. The merge confirmation must include branch name, worktree (if any), commit hash, and authors.

#### Scenario: Submit merge for a task
- **WHEN** user runs `atq submit-merge <task-id> --branch feature/x --commit abc123 --authors "agent-1,user"`
- **THEN** system transitions the task from Merging to Merged, clears the assigned agent, stores merge details (branch, worktree, commit, authors) in the task's conversation, and outputs confirmation

#### Scenario: Submit merge with worktree
- **WHEN** user runs `atq submit-merge <task-id> --branch feature/x --commit abc123 --worktree /tmp/ohxeng-123 --authors "agent-1"`
- **THEN** system records the worktree path along with branch, commit, and authors in the conversation entry
