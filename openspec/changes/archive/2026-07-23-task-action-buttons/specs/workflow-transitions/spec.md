## ADDED Requirements

### Requirement: Canceled tasks reject agent submissions
The system SHALL reject agent submissions (submit-plan, submit-code, submit-review, submit-merge) when the task status is Canceled. The agent SHALL receive a clear error message.

#### Scenario: Reject submit-plan on canceled task
- **WHEN** an agent submits a plan for a task in Canceled status
- **THEN** system returns a 400 error with message "Task is canceled and cannot accept submissions."

#### Scenario: Reject submit-code on canceled task
- **WHEN** an agent submits code for a task in Canceled status
- **THEN** system returns a 400 error with message "Task is canceled and cannot accept submissions."

#### Scenario: Reject submit-review on canceled task
- **WHEN** an agent submits a review for a task in Canceled status
- **THEN** system returns a 400 error with message "Task is canceled and cannot accept submissions."

#### Scenario: Reject submit-merge on canceled task
- **WHEN** an agent submits a merge for a task in Canceled status
- **THEN** system returns a 400 error with message "Task is canceled and cannot accept submissions."

### Requirement: User add comment
The system SHALL allow users to add a plain comment to a task's conversation without triggering any status transition.

#### Scenario: Add comment to conversation
- **WHEN** user provides comment text for a task in any status
- **THEN** system appends the text as a user-type conversation entry and does not change the task status
