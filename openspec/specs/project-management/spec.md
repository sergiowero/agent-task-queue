# Project Management

CRUD operations for managing projects in the ATQ system.

## Requirements

### Requirement: Project creation
The system SHALL allow users to create new projects.

#### Scenario: Create project with name and directory
- **WHEN** user provides a project name, display name, and working directory
- **THEN** system creates a new project record with a generated UUID, the provided fields, and timestamps

#### Scenario: Duplicate project name rejected
- **WHEN** user attempts to create a project with a name that already exists
- **THEN** system returns an error indicating the project name is already taken

### Requirement: Project listing
The system SHALL provide an endpoint to list all projects.

#### Scenario: List all projects
- **WHEN** client sends GET /api/projects
- **THEN** system returns 200 with an array of project objects including id, name, displayName, workingDirectory, created_at, and updated_at

### Requirement: Project deletion
The system SHALL allow users to delete projects.

#### Scenario: Delete existing project
- **WHEN** user sends DELETE /api/projects/:id with a valid ID
- **THEN** system removes the project record and returns 204 No Content

#### Scenario: Delete non-existent project
- **WHEN** user attempts to delete a project with an invalid ID
- **THEN** system returns 404 Not Found

### Requirement: Tasks belong to projects
The system SHALL associate each task with a project.

#### Scenario: Create task within project
- **WHEN** client sends POST /api/tasks with a projectId field
- **THEN** system creates the task and associates it with the specified project

#### Scenario: Filter tasks by project
- **WHEN** client sends GET /api/tasks?projectId=<id>
- **THEN** system returns only tasks belonging to the specified project
