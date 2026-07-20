## ADDED Requirements

### Requirement: REST API endpoints
The system SHALL provide REST API endpoints for task management operations.

#### Scenario: POST /api/tasks
- **WHEN** client sends POST request to /api/tasks with task data
- **THEN** system creates a new task and returns 201 with the task object

#### Scenario: GET /api/tasks
- **WHEN** client sends GET request to /api/tasks
- **THEN** system returns 200 with array of all tasks

#### Scenario: GET /api/tasks/:id
- **WHEN** client sends GET request to /api/tasks/:id with valid ID
- **THEN** system returns 200 with the task object

#### Scenario: PUT /api/tasks/:id
- **WHEN** client sends PUT request to /api/tasks/:id with update data
- **THEN** system updates the task and returns 200 with the updated task object

#### Scenario: DELETE /api/tasks/:id
- **WHEN** client sends DELETE request to /api/tasks/:id with valid ID
- **THEN** system deletes the task and returns 204

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
