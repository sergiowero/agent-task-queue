## ADDED Requirements

### Requirement: Request validation middleware
All POST and PUT endpoints SHALL validate request bodies against a Zod schema before processing.

#### Scenario: Validated POST /api/tasks
- **WHEN** client sends POST request to /api/tasks with valid task data
- **THEN** system validates the body against a Zod schema and returns 201 with the task object

#### Scenario: Invalid body returns 400 with details
- **WHEN** client sends POST request to /api/tasks with missing title
- **THEN** system returns 400 with `{ "error": "Validation failed", "details": [...] }`

### Requirement: Structured error handling
The server SHALL return structured error responses for all error conditions.

#### Scenario: Error response format
- **WHEN** any error occurs
- **THEN** the response body has `{ "error": "<message>" }` format

#### Scenario: Internal server error
- **WHEN** an unexpected error occurs in a handler
- **THEN** system returns 500 with `{ "error": "Internal server error" }` and logs the stack trace

### Requirement: Paginated task list endpoint
The GET /api/tasks endpoint SHALL support pagination with `limit` and `offset` query parameters and return a `total` count.

#### Scenario: Paginated tasks
- **WHEN** client sends GET /api/tasks?limit=10&offset=0
- **THEN** system returns 200 with `{ "tasks": [...], "total": 42, "limit": 10, "offset": 0 }`

### Requirement: Paginated activity endpoint
The GET /api/activity endpoint SHALL support pagination with `limit` and `offset` query parameters.

#### Scenario: Paginated activity
- **WHEN** client sends GET /api/activity?limit=25&offset=0
- **THEN** system returns 200 with `{ "events": [...], "total": 100 }`

### Requirement: Request logging
The server SHALL log each request with method, path, status, and duration.

#### Scenario: Request logged to stdout
- **WHEN** any request is handled
- **THEN** a log line is written: `[2024-01-01T00:00:00.000Z] GET /api/tasks 200 15ms`

## MODIFIED Requirements

### Requirement: REST API endpoints
The system SHALL provide REST API endpoints for task management, project management, workflow transitions, and activity feed operations. All mutation endpoints SHALL be wrapped in database transactions.

#### Scenario: POST /api/tasks/:id/submit-plan in transaction
- **WHEN** client sends POST request to /api/tasks/:id/submit-plan with plan content
- **THEN** system transitions task to Waiting Plan Review in a single database transaction and returns 200

#### Scenario: DELETE /api/tasks/:id with soft delete
- **WHEN** client sends DELETE request to /api/tasks/:id with valid ID
- **THEN** system sets deleted_at on the task and returns 204

#### Scenario: DELETE /api/tasks/:id?hard=true
- **WHEN** client sends DELETE request to /api/tasks/:id?hard=true with valid ID
- **THEN** system permanently deletes the task and returns 204

#### Scenario: DELETE /api/projects/:id with soft delete
- **WHEN** client sends DELETE request to /api/projects/:id with valid ID
- **THEN** system sets deleted_at on the project and returns 204

#### Scenario: DELETE /api/projects/:id?hard=true
- **WHEN** client sends DELETE request to /api/projects/:id?hard=true with valid ID
- **THEN** system permanently deletes the project and returns 204
