# Web Server

REST API endpoints for HTTP clients to interact with the task queue.

## Requirements

### Requirement: REST API endpoints
The system SHALL provide REST API endpoints for task management, project management, workflow transitions, and activity feed operations. Agent records are created exclusively through CLI claim actions — the web server exposes read-only agent listing for the portal.

#### Scenario: POST /api/tasks
- **WHEN** client sends POST request to /api/tasks with task data
- **THEN** system creates a new task and returns 201 with the task object

#### Scenario: GET /api/tasks
- **WHEN** client sends GET request to /api/tasks
- **THEN** system returns 200 with array of all tasks

#### Scenario: GET /api/tasks?projectId=<id>
- **WHEN** client sends GET request to /api/tasks with projectId query parameter
- **THEN** system returns 200 with array of tasks belonging to the specified project

#### Scenario: GET /api/tasks/:id
- **WHEN** client sends GET request to /api/tasks/:id with valid ID
- **THEN** system returns 200 with the task object

#### Scenario: PUT /api/tasks/:id
- **WHEN** client sends PUT request to /api/tasks/:id with update data
- **THEN** system updates the task and returns 200 with the updated task object

#### Scenario: DELETE /api/tasks/:id
- **WHEN** client sends DELETE request to /api/tasks/:id with valid ID
- **THEN** system deletes the task and returns 204

#### Scenario: POST /api/tasks/:id/submit-plan
- **WHEN** client sends POST request to /api/tasks/:id/submit-plan with plan content
- **THEN** system transitions task to Waiting Plan Review and returns 200

#### Scenario: POST /api/tasks/:id/submit-code
- **WHEN** client sends POST request to /api/tasks/:id/submit-code with code summary
- **THEN** system transitions task to Waiting Code Review and returns 200

#### Scenario: POST /api/tasks/:id/submit-review
- **WHEN** client sends POST request to /api/tasks/:id/submit-review with review content
- **THEN** system transitions task to Waiting Code Review and returns 200

#### Scenario: POST /api/tasks/:id/submit-merge
- **WHEN** client sends POST request to /api/tasks/:id/submit-merge with branch, commit, and authors
- **THEN** system transitions task to Merged, stores merge details in conversation, and returns 200

#### Scenario: POST /api/tasks/:id/submit-merge with worktree
- **WHEN** client sends POST request to /api/tasks/:id/submit-merge with branch, commit, authors, and worktree
- **THEN** system includes worktree path in the conversation entry alongside branch, commit, and authors

#### Scenario: POST /api/tasks/:id/approve-plan
- **WHEN** client sends POST request to /api/tasks/:id/approve-plan
- **THEN** system transitions task to Ready and returns 200

#### Scenario: POST /api/tasks/:id/request-plan-changes
- **WHEN** client sends POST request to /api/tasks/:id/request-plan-changes with feedback
- **THEN** system transitions task to Plan Changes Requested and returns 200

#### Scenario: POST /api/tasks/:id/approve-code
- **WHEN** client sends POST request to /api/tasks/:id/approve-code
- **THEN** system transitions task to Approved and returns 200

#### Scenario: POST /api/tasks/:id/request-code-changes
- **WHEN** client sends POST request to /api/tasks/:id/request-code-changes with feedback
- **THEN** system transitions task to Changes Requested and returns 200

#### Scenario: POST /api/tasks/:id/request-ai-review
- **WHEN** client sends POST request to /api/tasks/:id/request-ai-review
- **THEN** system transitions task to Code Review Requested and returns 200

#### Scenario: POST /api/tasks/:id/confirm-completion
- **WHEN** client sends POST request to /api/tasks/:id/confirm-completion
- **THEN** system transitions task to Complete and returns 200

#### Scenario: POST /api/tasks/:id/cancel
- **WHEN** client sends POST request to /api/tasks/:id/cancel
- **THEN** system transitions task to Canceled and returns 200

#### Scenario: POST /api/tasks/:id/unblock
- **WHEN** client sends POST request to /api/tasks/:id/unblock
- **THEN** system transitions task to the previous actionable state and returns 200

#### Scenario: GET /api/agents
- **WHEN** client sends GET request to /api/agents
- **THEN** system returns 200 with array of agent objects

#### Scenario: GET /api/agents?role=<role>
- **WHEN** client sends GET request to /api/agents with role query parameter
- **THEN** system returns 200 with array of agents matching the role

#### Scenario: GET /api/projects
- **WHEN** client sends GET request to /api/projects
- **THEN** system returns 200 with array of project objects

#### Scenario: POST /api/projects
- **WHEN** client sends POST request to /api/projects with project data
- **THEN** system creates a new project and returns 201

#### Scenario: DELETE /api/projects/:id
- **WHEN** client sends DELETE request to /api/projects/:id with valid ID
- **THEN** system deletes the project and returns 204

#### Scenario: GET /api/activity
- **WHEN** client sends GET request to /api/activity
- **THEN** system returns 200 with array of activity events sorted by timestamp descending

#### Scenario: GET /api/activity?taskId=<id>
- **WHEN** client sends GET request to /api/activity with taskId query parameter
- **THEN** system returns 200 with activity events for the specified task

#### Scenario: GET /api/events
- **WHEN** client sends GET request to /api/events
- **THEN** system establishes an SSE connection and streams task update events

#### Scenario: POST /api/tasks/:id/claim returns 404
- **WHEN** client sends POST request to /api/tasks/:id/claim
- **THEN** system returns 404 Not Found (claim endpoint removed, claiming is CLI-only)

### Requirement: JSON request/response
The system SHALL accept and return JSON in request and response bodies.

#### Scenario: JSON content type
- **WHEN** client sends request with Content-Type: application/json
- **THEN** system parses the JSON body correctly

### Requirement: Error handling
The system SHALL return appropriate HTTP status codes for error conditions.

#### Scenario: Invalid request body
- **WHEN** client sends request with malformed JSON
- **THEN** system returns 400 Bad Request

#### Scenario: Resource not found
- **WHEN** client requests a non-existent resource
- **THEN** system returns 404 Not Found

### Requirement: CORS support
The system SHALL allow cross-origin requests from any origin for development purposes.

#### Scenario: CORS preflight
- **WHEN** client sends OPTIONS request with Origin header
- **THEN** system returns appropriate CORS headers
