## MODIFIED Requirements

### Requirement: Project creation
The system SHALL allow users to create new projects. The default example displayName for a project SHALL be "AgentQ".

#### Scenario: Create project with name and directory
- **WHEN** user provides a project name, display name, and working directory
- **THEN** system creates a new project record with a generated UUID, the provided fields, and timestamps

#### Scenario: Duplicate project name rejected
- **WHEN** user attempts to create a project with a name that already exists
- **THEN** system returns an error indicating the project name is already taken
