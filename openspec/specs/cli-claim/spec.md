# CLI Claim

Automatic task selection for agents via CLI based on role eligibility and priority.

## Requirements

### Requirement: CLI claim with automatic task selection
The system SHALL provide a CLI command `atq claim` that automatically selects and claims the highest-priority task eligible for the agent's role.

#### Scenario: Claim with planner role
- **WHEN** agent runs `atq claim --name agent-1 --version 1.0 --model gpt-4 --role planner --session-id abc123`
- **THEN** system finds the highest-priority unclaimed task in New or Plan Changes Requested status, assigns the agent, transitions the task to Planning, and outputs the full task details

#### Scenario: Claim with implementer role
- **WHEN** agent runs `atq claim --name agent-1 --version 1.0 --model gpt-4 --role implementer --session-id abc123`
- **THEN** system finds the highest-priority unclaimed task in Ready, Changes Requested, or Approved status, assigns the agent, transitions the task to Coding (or Merging if Approved), and outputs the full task details

#### Scenario: Claim with reviewer role
- **WHEN** agent runs `atq claim --name agent-1 --version 1.0 --model gpt-4 --role reviewer --session-id abc123`
- **THEN** system finds the highest-priority unclaimed task in Code Review Requested status, assigns the agent, transitions the task to Reviewing, and outputs the full task details

#### Scenario: Claim with senior role uses priority ordering
- **WHEN** agent runs `atq claim --name agent-1 --version 1.0 --model gpt-4 --role senior --session-id abc123`
- **THEN** system tries planner-eligible tasks first, then implementer-eligible, then reviewer-eligible, picking the highest-priority task from the first non-empty group

#### Scenario: Claim with architect role uses priority ordering
- **WHEN** agent runs `atq claim --name agent-1 --version 1.0 --model gpt-4 --role architect --session-id abc123`
- **THEN** system tries planner-eligible tasks first, then reviewer-eligible (no implementer), picking the highest-priority task from the first non-empty group

#### Scenario: No claimable tasks available
- **WHEN** agent runs `atq claim` and no unclaimed tasks exist in eligible statuses
- **THEN** system outputs a message indicating no tasks are available and exits with code 0

#### Scenario: Missing required arguments
- **WHEN** agent runs `atq claim` without providing required identity arguments
- **THEN** system displays usage help and exits with code 1

### Requirement: Priority-based task ordering
The system SHALL order claimable tasks by priority descending, then by creation time ascending as tiebreaker.

#### Scenario: Higher priority task claimed first
- **WHEN** two unclaimed tasks exist: Task A with priority 100 and Task B with priority 50
- **THEN** system selects Task A for the claiming agent

#### Scenario: Same priority tasks ordered by creation time
- **WHEN** two unclaimed tasks exist with the same priority: Task A created earlier and Task B created later
- **THEN** system selects Task A (older task) for the claiming agent

### Requirement: Single-agent exclusivity
The system SHALL only allow one agent to claim a task at a time.

#### Scenario: Already claimed task skipped
- **WHEN** a task is already assigned to an agent
- **THEN** system skips that task when searching for claimable tasks

### Requirement: Auto-registration on claim
The system SHALL automatically create or update an agent record when an agent claims a task via CLI.

#### Scenario: Agent created on first claim
- **WHEN** an agent claims a task for the first time via CLI
- **THEN** system creates an agent record with toolName, version, model, role, sessionId derived from CLI arguments

#### Scenario: Agent updated on subsequent claims
- **WHEN** an agent with existing record claims a task
- **THEN** system updates the agent's last_seen timestamp

### Requirement: Claim outputs task context
The system SHALL output full task details after a successful claim so the agent has context to begin work.

#### Scenario: Successful claim output
- **WHEN** agent successfully claims a task
- **THEN** system outputs task title, description, acceptance criteria, recommended branch, merge branch, and status in structured format
