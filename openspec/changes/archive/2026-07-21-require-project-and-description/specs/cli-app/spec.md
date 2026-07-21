## MODIFIED Requirements

### Requirement: Task create command
The system SHALL provide a CLI command to create a new task. The `--project` flag is mandatory.

#### Scenario: Create task with all required fields
- **WHEN** user runs `atq create "My Task" --project <project-id> --description "Task details"`
- **THEN** system creates a new task with all provided fields and displays the created task details including project name and displayName

#### Scenario: Create task without project
- **WHEN** user runs `atq create "My Task"` without `--project`
- **THEN** system returns an error indicating `--project` is required

#### Scenario: Create task with merge branch
- **WHEN** user runs `atq create "My Task" --project <project-id> --description "Details" --merge-branch main`
- **THEN** system creates a task with merge_branch set to "main"

### Requirement: Task output includes project details
The system SHALL include complete project details (name, displayName, workingDirectory) in all CLI command outputs that return task data, both in text and JSON format.

#### Scenario: Text output shows project
- **WHEN** any CLI command outputs a task in text format
- **THEN** the output includes the project name and displayName

#### Scenario: JSON output includes project object
- **WHEN** any CLI command outputs a task in JSON format with `--json`
- **THEN** the JSON includes a `project` object with id, name, displayName, and workingDirectory
