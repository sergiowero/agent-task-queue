## ADDED Requirements

### Requirement: User approve plan
The system SHALL allow users to approve a plan, transitioning the task from Waiting Plan Review to Ready.

#### Scenario: Approve plan
- **WHEN** user approves a task in Waiting Plan Review status
- **THEN** system transitions the task to Ready and records the transition in history

### Requirement: User request plan changes
The system SHALL allow users to request plan changes, transitioning the task from Waiting Plan Review to Plan Changes Requested.

#### Scenario: Request plan changes with feedback
- **WHEN** user requests plan changes on a task in Waiting Plan Review status with feedback text
- **THEN** system transitions the task to Plan Changes Requested, adds the feedback to the conversation, and records the transition

### Requirement: User approve code
The system SHALL allow users to approve submitted code, transitioning the task from Waiting Code Review to Approved.

#### Scenario: Approve code
- **WHEN** user approves code on a task in Waiting Code Review status
- **THEN** system transitions the task to Approved and records the transition in history

### Requirement: User request code changes
The system SHALL allow users to request code changes, transitioning the task from Waiting Code Review to Changes Requested.

#### Scenario: Request code changes with feedback
- **WHEN** user requests code changes on a task in Waiting Code Review status with feedback text
- **THEN** system transitions the task to Changes Requested, adds the feedback to the conversation, and records the transition

### Requirement: User request AI review
The system SHALL allow users to request an on-demand AI code review, transitioning the task from Waiting Code Review to Code Review Requested.

#### Scenario: Request AI review
- **WHEN** user clicks "Request AI Review" on a task in Waiting Code Review status
- **THEN** system transitions the task to Code Review Requested and records the transition

### Requirement: User confirm completion
The system SHALL allow users to confirm task completion, transitioning the task from Merged to Complete.

#### Scenario: Confirm completion
- **WHEN** user confirms completion on a task in Merged status
- **THEN** system transitions the task to Complete and records the transition

### Requirement: User cancel task
The system SHALL allow users to cancel a task from any active state.

#### Scenario: Cancel task
- **WHEN** user cancels a task and confirms the action
- **THEN** system transitions the task to Canceled and records the transition

### Requirement: User unblock stuck task
The system SHALL allow users to unblock tasks stuck in Planning, Coding, or Reviewing status by returning them to the previous actionable state.

#### Scenario: Unblock task in Planning
- **WHEN** user unblocks a task in Planning status
- **THEN** system transitions the task to Plan Changes Requested, clears the assigned agent, and records the transition

#### Scenario: Unblock task in Coding
- **WHEN** user unblocks a task in Coding status
- **THEN** system transitions the task to Changes Requested, clears the assigned agent, and records the transition

#### Scenario: Unblock task in Reviewing
- **WHEN** user unblocks a task in Reviewing status
- **THEN** system transitions the task to Code Review Requested, clears the assigned agent, and records the transition

### Requirement: Agent claim task
The system SHALL allow agents to claim tasks in valid states based on their role.

#### Scenario: Implementer claims Ready task
- **WHEN** an implementer agent claims a task in Ready status
- **THEN** system transitions the task to Coding and assigns the agent

#### Scenario: Implementer claims Changes Requested task
- **WHEN** an implementer agent claims a task in Changes Requested status
- **THEN** system transitions the task to Coding and assigns the agent

#### Scenario: Planner claims New task
- **WHEN** a planner agent claims a task in New status
- **THEN** system transitions the task to Planning and assigns the agent

#### Scenario: Planner claims Plan Changes Requested task
- **WHEN** a planner agent claims a task in Plan Changes Requested status
- **THEN** system transitions the task to Planning and assigns the agent

#### Scenario: Reviewer claims Code Review Requested task
- **WHEN** a reviewer agent claims a task in Code Review Requested status
- **THEN** system transitions the task to Reviewing and assigns the agent

#### Scenario: Senior agent claims any eligible task
- **WHEN** a senior agent claims a task in any state eligible for any of their roles
- **THEN** system transitions the task to the appropriate state and assigns the agent

#### Scenario: Claim rejected for invalid state
- **WHEN** an agent attempts to claim a task in a state not valid for their role
- **THEN** system returns an error indicating the task is not claimable in its current state

#### Scenario: Claim rejected for already claimed task
- **WHEN** an agent attempts to claim a task already assigned to another agent
- **THEN** system returns an error indicating the task is already claimed

### Requirement: Agent submit plan
The system SHALL transition a task from Planning to Waiting Plan Review when an agent submits a plan.

#### Scenario: Submit plan
- **WHEN** an agent submits a plan for a task in Planning status
- **THEN** system transitions the task to Waiting Plan Review, adds the plan to the conversation, and clears the assigned agent

### Requirement: Agent submit code
The system SHALL transition a task from Coding to Waiting Code Review when an agent submits code.

#### Scenario: Submit code
- **WHEN** an agent submits code for a task in Coding status
- **THEN** system transitions the task to Waiting Code Review, adds a code summary to the conversation, and clears the assigned agent

### Requirement: Agent submit review
The system SHALL transition a task from Reviewing back to Waiting Code Review when an agent submits a review.

#### Scenario: Submit review
- **WHEN** an agent submits a review for a task in Reviewing status
- **THEN** system transitions the task to Waiting Code Review, adds the review result to the conversation, and clears the assigned agent

### Requirement: Agent submit merge
The system SHALL transition a task from Merging to Merged when an agent submits a merge.

#### Scenario: Submit merge
- **WHEN** an agent submits a merge for a task in Merging status
- **THEN** system transitions the task to Merged, adds a merge confirmation to the conversation, and clears the assigned agent
