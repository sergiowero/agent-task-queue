## ADDED Requirements

### Requirement: Project list command
The system SHALL provide a CLI command to list all registered projects.

#### Scenario: List projects
- **WHEN** user runs `agentq projects`
- **THEN** system displays a formatted list of all projects with IDs, display names, and working directories

#### Scenario: List projects as JSON
- **WHEN** user runs `agentq projects --json`
- **THEN** system outputs JSON array with id, displayName, workingDirectory for each project

## MODIFIED Requirements

### Requirement: Task create command
The system SHALL provide a CLI command to create a new task. The `--project` and `--description` flags are mandatory.

#### Scenario: Create task with all required fields
- **WHEN** user runs `agentq create "My Task" --project <project-id> --description "Task details"`
- **THEN** system creates a new task with all provided fields and displays the created task details including project name and displayName

#### Scenario: Create task without project
- **WHEN** user runs `agentq create "My Task"` without `--project`
- **THEN** system returns an error indicating `--project` is required

#### Scenario: Create task without description
- **WHEN** user runs `agentq create "My Task" --project <project-id>` without `--description`
- **THEN** system returns an error indicating `--description` is required

#### Scenario: Create task with merge branch
- **WHEN** user runs `agentq create "My Task" --project <project-id> --description "Details" --merge-branch main`
- **THEN** system creates a task with merge_branch set to "main"
