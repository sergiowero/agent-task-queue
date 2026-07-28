## ADDED Requirements

### Requirement: Toast notifications
The application SHALL display toast notifications for successful and failed mutations (task create, project save, etc.).

#### Scenario: Success toast
- **WHEN** a task is created successfully
- **THEN** a green toast appears with "Task created" for 3 seconds

#### Scenario: Error toast
- **WHEN** a mutation fails
- **THEN** a red toast appears with the error message

### Requirement: Loading skeletons
List and detail pages SHALL display skeleton placeholders while data is loading instead of plain "Loading..." text.

#### Scenario: Board shows skeletons
- **WHEN** tasks are loading
- **THEN** the board columns show animated placeholder cards

#### Scenario: Task detail shows skeleton
- **WHEN** a task detail is loading
- **THEN** the page shows animated placeholder blocks for header, metadata, and tabs

### Requirement: Empty state illustrations
Pages with no data SHALL display a relevant empty state with an icon and descriptive text.

#### Scenario: No tasks
- **WHEN** the board has no tasks
- **THEN** it displays an empty state with "No tasks yet — create one to get started"

#### Scenario: No projects
- **WHEN** the projects page has no projects
- **THEN** it displays an empty state with "No projects yet"

### Requirement: Human-readable status labels
Status filter dropdowns and badges SHALL display human-readable labels instead of raw enum values.

#### Scenario: Status filter shows labels
- **WHEN** the board page status filter is opened
- **THEN** it displays "Plan Requested" instead of "plan_requested"

### Requirement: ActivityPage dark mode
The ActivityPage SHALL use CSS variable-based Tailwind classes instead of hardcoded gray colors to support dark mode.

#### Scenario: ActivityPage in dark mode
- **WHEN** the theme is set to dark
- **THEN** the ActivityPage displays correctly with dark theme colors
