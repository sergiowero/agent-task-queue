## MODIFIED Requirements

### Requirement: User approve plan
The system SHALL allow users to approve a plan, transitioning the task from Waiting Plan Review to Ready for Code.

#### Scenario: Approve plan
- **WHEN** user approves a task in Waiting Plan Review status
- **THEN** system transitions the task to Ready for Code and records the transition in history

### Requirement: Agent claim task
The system SHALL automatically assign tasks to agents based on role eligibility and priority via the CLI. The CLI is the exclusive interface for claiming.

#### Scenario: Implementer claims highest priority Ready for Code task
- **WHEN** an implementer agent claims via CLI
- **THEN** system finds the highest-priority unclaimed task in Ready for Code status, transitions it to Coding, and assigns the agent

#### Scenario: Implementer claims highest priority Changes Requested task
- **WHEN** an implementer agent claims via CLI and no Ready for Code tasks are available
- **THEN** system finds the highest-priority unclaimed task in Changes Requested status, transitions it to Coding, and assigns the agent

#### Scenario: Implementer claims highest priority Approved task
- **WHEN** an implementer agent claims via CLI and no Ready for Code or Changes Requested tasks are available
- **THEN** system finds the highest-priority unclaimed task in Approved status, transitions it to Merging, and assigns the agent
