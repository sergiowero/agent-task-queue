# CLI App

Delta spec for context-related CLI changes.

## ADDED Requirements

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
