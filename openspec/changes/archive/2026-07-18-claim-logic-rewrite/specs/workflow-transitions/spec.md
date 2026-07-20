## MODIFIED Requirements

### Requirement: Agent claim task
The system SHALL automatically assign tasks to agents based on role eligibility and priority, rather than allowing agents to select specific tasks. The CLI is the exclusive interface for claiming.

#### Scenario: Planner claims highest priority New task
- **WHEN** a planner agent claims via CLI
- **THEN** system finds the highest-priority unclaimed task in New status, transitions it to Planning, and assigns the agent

#### Scenario: Planner claims highest priority Plan Changes Requested task
- **WHEN** a planner agent claims via CLI and no New tasks are available
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
- **THEN** system tries planner-eligible tasks first (New, Plan Changes Requested), then implementer-eligible (Ready, Changes Requested, Approved), then reviewer-eligible (Code Review Requested), selecting the highest-priority task from the first non-empty group

#### Scenario: Architect agent uses role priority ordering
- **WHEN** an architect agent claims via CLI
- **THEN** system tries planner-eligible tasks first (New, Plan Changes Requested), then reviewer-eligible (Code Review Requested), selecting the highest-priority task from the first non-empty group

#### Scenario: No claimable tasks available
- **WHEN** an agent claims via CLI and no unclaimed tasks exist in any eligible status
- **THEN** system outputs a message indicating no tasks are available

#### Scenario: Claim rejected for already claimed task
- **WHEN** an agent attempts to claim a task already assigned to another agent
- **THEN** system skips that task and continues searching for the next eligible task

### Requirement: Agent submit merge
The system SHALL transition a task from Merging to Merged when an agent submits a merge, recording the branch name, worktree path (if any), commit hash, and authors in the conversation.

#### Scenario: Submit merge with full details
- **WHEN** an agent submits a merge for a task in Merging status with branch, commit, and authors
- **THEN** system transitions the task to Merged, adds a conversation entry containing branch name, commit hash, and authors, clears the assigned agent, and records the transition

#### Scenario: Submit merge with worktree
- **WHEN** an agent submits a merge with a worktree path
- **THEN** system includes the worktree path in the conversation entry alongside branch, commit, and authors
