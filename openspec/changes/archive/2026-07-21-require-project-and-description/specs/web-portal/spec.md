## MODIFIED Requirements

#### Scenario: User creates task from board
- **WHEN** user clicks the "New Task" button
- **THEN** system opens a task creation form with fields for title (required), description (required), project (required dropdown), acceptance criteria, priority, branch, merge branch, and planning requirement toggle

#### Scenario: User cannot create task without project
- **WHEN** user clicks "Create" without selecting a project
- **THEN** the create button is disabled and the form is not submitted

#### Scenario: User cannot create task without description
- **WHEN** user clicks "Create" without entering a description
- **THEN** the create button is disabled and the form is not submitted

#### Scenario: User cannot create task without title
- **WHEN** user clicks "Create" without entering a title
- **THEN** the create button is disabled and the form is not submitted

#### Scenario: Merge branch defaults to develop
- **WHEN** user opens the task creation form
- **THEN** the merge branch field is pre-filled with "develop" and can be edited
