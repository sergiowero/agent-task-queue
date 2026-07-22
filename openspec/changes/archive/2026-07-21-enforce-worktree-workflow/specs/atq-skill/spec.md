## ADDED Requirements

### Requirement: Agents must create worktree before coding
Agents SHALL create a worktree at `.atq/worktrees/{taskId}` inside the project before writing any code. If a worktree already exists for the task, agents MUST use that path.

#### Scenario: Agent starts coding on fresh task
- **WHEN** agent claims task with status `ready for code`
- **THEN** agent creates worktree at `{project}/.atq/worktrees/{taskId}` before writing code

#### Scenario: Agent claims task with existing worktree
- **WHEN** agent claims task where `worktreePath` is already set
- **THEN** agent uses the existing worktree path without creating a new one

### Requirement: Agents focus on single task
Agents SHALL only work on the task they claimed. Agents MUST NOT jump to other tasks or continue working after submission.

#### Scenario: Agent completes task submission
- **WHEN** agent submits code/plan/review via `atq submit-*`
- **THEN** agent stops and waits for next claim — does not claim another task automatically

#### Scenario: Agent encounters blocked task
- **WHEN** agent cannot complete a task due to unclear requirements
- **THEN** agent submits with notes explaining the blocker — does not switch to a different task

### Requirement: Agents only use allowed CLI commands
Agents SHALL only use `atq claim` and `atq submit-*` commands. Agents MUST NOT use `atq list`, `atq get`, or any other CLI commands.

#### Scenario: Agent needs task information
- **WHEN** agent needs task details
- **THEN** agent uses data from the `atq claim` response — not `atq list` or `atq get`

### Requirement: Agents do not ask for permission
Agents SHALL work autonomously without asking the user for confirmation, approval, or permission during task execution.

#### Scenario: Agent receives a task
- **WHEN** agent claims a task
- **THEN** agent works on it immediately without asking "should I start?"

#### Scenario: Agent is unsure about approach
- **WHEN** agent encounters ambiguity in task requirements
- **THEN** agent uses reasonable judgment and submits with notes — does not ask for approval
