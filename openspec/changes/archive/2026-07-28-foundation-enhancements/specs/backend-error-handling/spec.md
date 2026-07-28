## ADDED Requirements

### Requirement: Zod request validation
Every API endpoint SHALL validate its request body using a Zod schema before processing.

#### Scenario: Valid request succeeds
- **WHEN** a POST/PUT request has a valid JSON body matching the schema
- **THEN** the endpoint processes the request normally

#### Scenario: Invalid request returns 400
- **WHEN** a POST/PUT request has a missing or malformed body
- **THEN** the endpoint returns 400 with `{ "error": "...", "details": [...] }`

#### Scenario: Invalid JSON returns 400 with clear message
- **WHEN** a POST/PUT request has unparseable JSON
- **THEN** the endpoint returns 400 with `{ "error": "Invalid JSON in request body" }`

### Requirement: Global error handler
The web server SHALL wrap all route handlers in a try/catch that returns structured 500 errors.

#### Scenario: Unhandled exception returns 500
- **WHEN** a route handler throws an unexpected error
- **THEN** the server returns 500 with `{ "error": "Internal server error" }` and logs the stack trace

### Requirement: Structured request logging
The web server SHALL log every request with method, path, status code, and duration.

#### Scenario: Request is logged
- **WHEN** any request is handled
- **THEN** a log line is written: `GET /api/tasks 200 12ms`

### Requirement: Paginated API endpoints
Tasks, activity, and agents list endpoints SHALL support `limit` and `offset` query parameters.

#### Scenario: Paginated tasks list
- **WHEN** calling `GET /api/tasks?limit=10&offset=0`
- **THEN** the response returns at most 10 tasks with total count

#### Scenario: Default pagination
- **WHEN** calling `GET /api/tasks` without pagination params
- **THEN** the response includes a default page of results (limit=50)
