# ATQ Skill

Delta spec for context submission in agent workflow.

## ADDED Requirements

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
