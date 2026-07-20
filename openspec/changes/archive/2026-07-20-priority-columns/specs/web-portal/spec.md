# Web Portal

React + Vite frontend for the ATQ task management dashboard.

## ADDED Requirements

### Requirement: Inline priority editing
The system SHALL allow users to edit a task's priority directly from the task card on the board.
The system SHALL display the priority badge for all tasks, including priority 0.

#### Scenario: Click priority badge to edit
- **WHEN** user clicks the priority badge on a task card
- **THEN** the badge transforms into an editable number input

#### Scenario: Save priority on enter
- **WHEN** user types a new priority value and presses Enter
- **THEN** system saves the new priority via PUT /api/tasks/:id and re-sorts the column

#### Scenario: Save priority on blur
- **WHEN** user types a new priority value and clicks away from the input
- **THEN** system saves the new priority via PUT /api/tasks/:id and re-sorts the column

#### Scenario: Cancel edit on escape
- **WHEN** user presses Escape while editing priority
- **THEN** input reverts to the original value without saving

#### Scenario: Editing priority does not open card details
- **WHEN** user clicks the priority input to edit a value
- **THEN** the card details drawer does not open (input events are isolated from card click)

#### Scenario: Priority badge shows for all values
- **WHEN** a task card is rendered
- **THEN** the priority badge is always visible, even when priority is 0

### Requirement: Reordering via priority only
The system SHALL NOT support drag-and-drop reordering of task cards.
The only mechanism to reorder tasks within a column SHALL be changing the task's priority value.

#### Scenario: No drag-and-drop interaction
- **WHEN** user attempts to drag a task card
- **THEN** the card does not respond to drag gestures (no drag affordance, no visual feedback)

#### Scenario: Reorder through priority change
- **WHEN** user changes a task's priority via inline editing
- **THEN** the task moves to its new position based on the updated priority value

## MODIFIED Requirements

### Requirement: Kanban board view
The system SHALL display a Kanban-style board with columns representing action buckets.
Tasks within each column SHALL be sorted by priority descending (highest value first),
with tasks of equal priority ordered by creation date ascending (oldest first).

#### Scenario: Board displays task columns
- **WHEN** user navigates to the board view
- **THEN** system displays columns for Pending, In Progress, Need Review, and Done, each containing task cards grouped by their workflow status

#### Scenario: Tasks sorted by priority within column
- **WHEN** a column contains multiple tasks
- **THEN** tasks are displayed in descending priority order, with highest priority at the top

#### Scenario: Equal priority tasks ordered by creation date
- **WHEN** two tasks in the same column have equal priority
- **THEN** the older task (earlier created_at) appears above the newer task

#### Scenario: Task card displays metadata
- **WHEN** a task card is rendered in a column
- **THEN** the card shows title, editable priority badge, branch name, current status, assigned agent name, and badges for planning/review requirements

#### Scenario: Column show/hide settings
- **WHEN** user opens board settings
- **THEN** system presents toggles for each column allowing the user to show or hide columns from the board

#### Scenario: Filter tasks by project
- **WHEN** user selects a project filter in the top bar
- **THEN** system shows only tasks belonging to that project across all columns

#### Scenario: Filter tasks by status, agent, tool, or model
- **WHEN** user applies a filter for status, agent, tool, or model
- **THEN** system narrows the visible task cards to match the filter criteria

#### Scenario: Search tasks by title or branch
- **WHEN** user types in the search bar
- **THEN** system filters task cards whose title or branch name matches the search query

#### Scenario: Refresh board
- **WHEN** user clicks the refresh button or presses the refresh keyboard shortcut
- **THEN** system fetches the latest task data and re-renders the board
