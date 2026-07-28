## ADDED Requirements

### Requirement: Database test isolation
Tests SHALL use an isolated in-memory or temp-file SQLite database to avoid polluting the production database.

#### Scenario: Test uses isolated DB
- **WHEN** a test runs
- **THEN** it sets `AGENTQ_DB_PATH=:memory:` or a temp file and cleans up after

### Requirement: Expanded test coverage
Each package SHALL have tests covering its core functionality.

#### Scenario: Shared package tests
- **WHEN** running tests in the shared package
- **THEN** all CRUD operations, workflow transitions, and soft delete behavior are covered

#### Scenario: Web server tests
- **WHEN** running tests in the web package
- **THEN** all API endpoints, validation, pagination, and error handling are covered

#### Scenario: CLI tests
- **WHEN** running tests in the CLI package
- **THEN** all commands, output formats, and option handling are covered

#### Scenario: Frontend tests
- **WHEN** running tests in the web-ui package
- **THEN** key components (Board, TaskDetail, Modals) and hooks (useSSE) are covered with React Testing Library
