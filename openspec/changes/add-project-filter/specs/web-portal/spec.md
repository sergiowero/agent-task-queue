## ADDED Requirements

### Requirement: Project filter dropdown in board top bar
The system SHALL display a project filter dropdown in the board top bar, allowing users to filter tasks by project without leaving the board view.

#### Scenario: Dropdown displays all projects
- **WHEN** the board view renders
- **THEN** the top bar shows a project filter dropdown populated with all available projects plus an "All projects" option

#### Scenario: Dropdown shows current selection from URL
- **WHEN** the board is loaded with a `projectId` search param
- **THEN** the project filter dropdown reflects the corresponding project as selected

#### Scenario: Selecting a project filters the board
- **WHEN** user selects a project from the dropdown
- **THEN** the URL updates with the `projectId` search param and the board shows only tasks belonging to that project

#### Scenario: Selecting All projects clears the filter
- **WHEN** user selects "All projects" from the dropdown
- **THEN** the `projectId` search param is removed and the board shows all tasks

#### Scenario: Dropdown is styled consistently with other filters
- **WHEN** the project filter dropdown is rendered
- **THEN** it uses the same visual styling as the status and agent filter dropdowns
