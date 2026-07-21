## MODIFIED Requirements

### Requirement: Agent claim task
The system SHALL automatically assign tasks to agents based on role eligibility and priority via the CLI. The CLI is the exclusive interface for claiming.

#### Scenario: Planner claims highest priority PlanRequested task
- **WHEN** a planner agent claims via CLI
- **THEN** system finds the highest-priority unclaimed task in PlanRequested status, transitions it to Planning, and assigns the agent

#### Scenario: Planner claims highest priority Plan Changes Requested task
- **WHEN** a planner agent claims via CLI and no PlanRequested tasks are available
- **THEN** system finds the highest-priority unclaimed task in Plan Changes Requested status, transitions it to Planning, and assigns the agent

#### Scenario: Implementer claims highest priority Ready task
- **WHEN** an implementer agent claims via CLI
- **THEN** system finds the highest-priority unclaimed task in Ready status, transitions it to Coding, and assigns the agent

#### Scenario: Implementer claims highest priority Changes Requested task
- **WHEN** an implementer agent claims via CLI and no Ready tasks are available
- **THEN** system finds the highest-priority unclaimed task in Changes Requested status, transitions it to Coding, and assigns the agent

#### Scenario: Implementer claims highest priority Approved task
- **WHEN** an implementer agent claims via CLI and no Ready or Changes Requested tasks are available
- **THEN** system finds the highest-priority unclaimed task in Approved status, transitions it to Merging, and assigns the agent

#### Scenario: Reviewer claims highest priority Code Review Requested task
- **WHEN** a reviewer agent claims via CLI
- **THEN** system finds the highest-priority unclaimed task in Code Review Requested status, transitions it to Reviewing, and assigns the agent

#### Scenario: Senior agent uses role priority ordering
- **WHEN** a senior agent claims via CLI
- **THEN** system tries planner-eligible tasks first, then implementer-eligible, then reviewer-eligible, selecting the highest-priority task from the first non-empty group

#### Scenario: Architect agent uses role priority ordering
- **WHEN** an architect agent claims via CLI
- **THEN** system tries planner-eligible tasks first, then reviewer-eligible (no implementer), selecting the highest-priority task from the first non-empty group

#### Scenario: No claimable tasks available
- **WHEN** an agent claims via CLI and no unclaimed tasks exist in eligible statuses
- **THEN** system outputs a message indicating no tasks are available

#### Scenario: Claim skipped for already claimed task
- **WHEN** a task is already assigned to another agent
- **THEN** system skips that task and continues searching for the next eligible task
