## MODIFIED Requirements

### Requirement: Project listing with pagination
The system SHALL provide an endpoint to list projects with pagination support.

#### Scenario: List all projects with pagination
- **WHEN** client sends GET /api/projects
- **THEN** system returns 200 with an array of active (non-deleted) project objects including id, displayName, workingDirectory, createdAt, and updatedAt

### Requirement: Project deletion with soft delete
The system SHALL soft-delete projects by setting `deleted_at`. A `?hard=true` query parameter SHALL perform actual deletion.

#### Scenario: Soft delete existing project
- **WHEN** user sends DELETE /api/projects/:id with a valid ID
- **THEN** system sets deleted_at and returns 204 No Content

#### Scenario: Hard delete existing project
- **WHEN** user sends DELETE /api/projects/:id?hard=true with a valid ID
- **THEN** system permanently removes the project record and returns 204 No Content

#### Scenario: Delete non-existent project
- **WHEN** user attempts to delete a project with an invalid ID
- **THEN** system returns 404 Not Found
