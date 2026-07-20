# Activity Feed

Global event stream of task lifecycle events for monitoring and audit.

## Requirements

### Requirement: Global activity stream
The system SHALL maintain a global activity stream recording all significant task events.

#### Scenario: Activity event on status change
- **WHEN** a task's status changes
- **THEN** system creates an activity event with event type "status_change", the task ID, previous status, new status, actor (user or agent), and timestamp

#### Scenario: Activity event on comment
- **WHEN** a message is added to a task's conversation
- **THEN** system creates an activity event with event type "comment", the task ID, author name, and timestamp

#### Scenario: Activity event on task creation
- **WHEN** a new task is created
- **THEN** system creates an activity event with event type "task_created", the task ID, and timestamp

#### Scenario: Activity event on task completion
- **WHEN** a task transitions to Complete status
- **THEN** system creates an activity event with event type "task_completed", the task ID, and timestamp

### Requirement: Activity listing endpoint
The system SHALL provide an endpoint to retrieve the activity feed.

#### Scenario: List all activity events
- **WHEN** client sends GET /api/activity
- **THEN** system returns 200 with an array of activity events sorted by timestamp descending

#### Scenario: Filter activity by task
- **WHEN** client sends GET /api/activity?taskId=<id>
- **THEN** system returns only events for the specified task

#### Scenario: Filter activity by agent
- **WHEN** client sends GET /api/activity?agentId=<id>
- **THEN** system returns only events where the actor matches the specified agent

#### Scenario: Filter activity by date range
- **WHEN** client sends GET /api/activity?from=<timestamp>&to=<timestamp>
- **THEN** system returns only events within the specified date range

#### Scenario: Limit activity results
- **WHEN** client sends GET /api/activity?limit=<n>
- **THEN** system returns at most n events (default 50)
