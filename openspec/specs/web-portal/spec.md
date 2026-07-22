# Web Portal

React + Vite frontend for the ATQ task management dashboard.

## Requirements

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

#### Scenario: Project filter dropdown displays all projects
- **WHEN** the board view renders
- **THEN** the top bar shows a project filter dropdown populated with all available projects plus an "All projects" option

#### Scenario: Project filter shows current selection from URL
- **WHEN** the board is loaded with a `projectId` search param
- **THEN** the project filter dropdown reflects the corresponding project as selected

#### Scenario: Selecting a project filters the board
- **WHEN** user selects a project from the dropdown
- **THEN** the URL updates with the `projectId` search param and the board shows only tasks belonging to that project

#### Scenario: Selecting All projects clears the filter
- **WHEN** user selects "All projects" from the dropdown
- **THEN** the `projectId` search param is removed and the board shows all tasks

#### Scenario: Project filter dropdown is styled consistently
- **WHEN** the project filter dropdown is rendered
- **THEN** it uses the same visual styling as the status and agent filter dropdowns

#### Scenario: Filter tasks by status, agent, tool, or model
- **WHEN** user applies a filter for status, agent, tool, or model
- **THEN** system narrows the visible task cards to match the filter criteria

#### Scenario: Search tasks by title or branch
- **WHEN** user types in the search bar
- **THEN** system filters task cards whose title or branch name matches the search query

#### Scenario: Refresh board
- **WHEN** user clicks the refresh button or presses the refresh keyboard shortcut
- **THEN** system fetches the latest task data and re-renders the board

### Requirement: Task detail drawer
The system SHALL provide a right-side drawer that opens over the board when a task card is selected.

#### Scenario: Open task detail
- **WHEN** user clicks a task card on the board
- **THEN** system opens a right-side drawer showing the full task details with tabs for Summary, Conversation, and History

#### Scenario: Summary tab shows task metadata
- **WHEN** user views the Summary tab in the task drawer
- **THEN** system displays title, description, acceptance criteria, priority, recommended branch, real branch, merge target, assigned agent, status, and status history

#### Scenario: Conversation tab shows messages
- **WHEN** user views the Conversation tab in the task drawer
- **THEN** system displays a chronological thread of messages with author name, timestamp, and message content

#### Scenario: History tab shows state transitions
- **WHEN** user views the History tab in the task drawer
- **THEN** system displays a timeline of status transitions with previous status, new status, and timestamp

#### Scenario: User approves plan from drawer
- **WHEN** user clicks "Approve Plan" while task is in Waiting Plan Review status
- **THEN** system transitions the task to Ready for Code and adds a system message to the conversation

#### Scenario: User requests plan changes from drawer
- **WHEN** user clicks "Request Plan Changes" while task is in Waiting Plan Review status
- **THEN** system transitions the task to Plan Changes Requested and prompts user for feedback text

#### Scenario: User approves code from drawer
- **WHEN** user clicks "Approve Code" while task is in Waiting Code Review status
- **THEN** system transitions the task to Approved and adds a system message to the conversation

#### Scenario: User requests code changes from drawer
- **WHEN** user clicks "Request Code Changes" while task is in Waiting Code Review status
- **THEN** system transitions the task to Changes Requested and prompts user for feedback text

#### Scenario: User requests AI review from drawer
- **WHEN** user clicks "Request AI Review" while task is in Waiting Code Review status
- **THEN** system transitions the task to Code Review Requested and adds a system message to the conversation

#### Scenario: User cancels task from drawer
- **WHEN** user clicks "Cancel Task" and confirms the action
- **THEN** system transitions the task to Canceled and adds a system message to the conversation

#### Scenario: User unblocks stuck task from drawer
- **WHEN** user clicks "Unblock" next to the cancel button while task is in Planning, Coding, or Reviewing status
- **THEN** system transitions the task back to its previous actionable state and clears the assigned agent

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

#### Scenario: User edits task metadata from drawer
- **WHEN** user edits a field in the Summary tab and saves
- **THEN** system updates the task and reflects the change on the board

### Requirement: Board column mapping
The system SHALL map workflow statuses to board columns according to a fixed mapping.

#### Scenario: Pending column groups correct statuses
- **WHEN** tasks are grouped into the Pending column
- **THEN** tasks with status PlanRequested, Ready for Code, Plan Changes Requested, Code Review Requested, Changes Requested, or Approved are displayed

#### Scenario: In Progress column groups correct statuses
- **WHEN** tasks are grouped into the In Progress column
- **THEN** tasks with status Planning, Coding, Reviewing, or Merging are displayed

#### Scenario: Need Review column groups correct statuses
- **WHEN** tasks are grouped into the Need Review column
- **THEN** tasks with status Waiting Plan Review or Waiting Code Review are displayed

#### Scenario: Done column groups correct statuses
- **WHEN** tasks are grouped into the Done column
- **THEN** tasks with status Complete or Merged are displayed

### Requirement: Agents view
The system SHALL display a view listing all registered agents and their current activity.

#### Scenario: Agent list displays agent metadata
- **WHEN** user navigates to the agents view
- **THEN** system displays a table of agents with name, tool, model, role, session ID, last seen timestamp, and current task

#### Scenario: Active vs inactive visual separation
- **WHEN** agent list is rendered
- **THEN** active agents (seen within last 5 minutes) are visually distinct from inactive agents

#### Scenario: Filter agents by role or tool
- **WHEN** user applies a role or tool filter
- **THEN** system narrows the agent list to matching agents

### Requirement: Activity and monitoring view
The system SHALL display a global activity stream of task events.

#### Scenario: Activity stream shows task state changes
- **WHEN** user navigates to the activity view
- **THEN** system displays a timeline of events including task state changes, comments, approvals, review requests, merges, and completions

#### Scenario: Filter activity by agent, date, or action type
- **WHEN** user applies filters to the activity stream
- **THEN** system narrows the events to match the filter criteria

### Requirement: Desktop-first layout
The system SHALL provide a desktop-optimized layout with a left sidebar, top bar, and central content area. The layout SHALL use consistent spacing, depth, and color hierarchy from the design system.

#### Scenario: Left sidebar shows project list
- **WHEN** user views the application
- **THEN** system displays a left sidebar with a list of projects and a way to create new projects, styled with theme surface color and subtle border

#### Scenario: Top bar shows search, filters, and theme toggle
- **WHEN** user views the application
- **THEN** system displays a top bar with search input, filter controls, and a theme toggle button for light/dark mode switching

#### Scenario: Sidebar uses theme colors
- **WHEN** theme changes between light and dark
- **THEN** sidebar background, border, and text colors update according to the active theme

### Requirement: Real-time board updates via SSE
The system SHALL push live updates to the board without requiring manual refresh.

#### Scenario: SSE connection established
- **WHEN** user loads the board view
- **THEN** system opens an SSE connection to /api/events

#### Scenario: Task update pushed to board
- **WHEN** a task is updated by any agent or user action
- **THEN** the board receives the update event and re-renders the affected task card

#### Scenario: SSE reconnection
- **WHEN** the SSE connection drops
- **THEN** the client automatically reconnects and fetches any missed updates
