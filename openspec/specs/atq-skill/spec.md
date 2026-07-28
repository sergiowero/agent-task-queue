# ATQ Skill

Agent behavior rules for ATQ workflow execution.

## Requirements

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

### Requirement: Agents include context on submissions
Agents SHALL include a `--context` flag on every `atq submit-*` command with a short summary of their current state: what was accomplished, what was found, blockers, or anything the next agent handling the task should know.

#### Scenario: Agent submits plan with context
- **WHEN** agent runs `atq submit-plan <task-id> -m "Plan" --context "<summary>"`
- **THEN** the context entry is recorded for the next agent or reviewer

#### Scenario: Agent submits code with context
- **WHEN** agent runs `atq submit-code <task-id> -m "Done" -w <path> --context "<summary>"`
- **THEN** the context entry records what was implemented and any caveats

#### Scenario: Agent submits review with context
- **WHEN** agent runs `atq submit-review <task-id> -m "Review" --context "<summary>"`
- **THEN** the context entry records review findings and recommendations

#### Scenario: Agent claims with context
- **WHEN** agent runs `atq claim -n <name> -v <ver> -m <model> -r <role> -s <session> --context "<initial state>"`
- **THEN** the initial context is recorded for the task

### Requirement: Context is focused on task-specific state
Context entries SHALL be concise summaries of the agent's current understanding, findings, and blockers related to the specific task. They SHALL NOT include meta-commentary about the agent's own performance or unrelated information.

#### Scenario: Context contains actionable information
- **WHEN** an agent writes a context entry
- **THEN** it focuses on what was done, what was found, what comes next, or what is blocked
