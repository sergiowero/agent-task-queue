# Task Detail Page

Full-page task detail view replacing the side-panel drawer, with per-type message styling for conversation entries.

## Requirements

### Requirement: Task detail page displays full task information

The system SHALL provide a full-page task detail view at `/tasks/:id/details` that displays all task metadata, followed by a two-tab section for conversation and history.

#### Scenario: Navigate to task detail from board
- **WHEN** user clicks a task card on the board
- **THEN** the browser navigates to `/tasks/:id/details` showing the full detail page

#### Scenario: Task detail page layout
- **WHEN** the task detail page loads
- **THEN** the first section shows task metadata (title, status badge, priority, branch, agent, worktree, acceptance criteria) and a "Back to Board" button
- **THEN** below the metadata, two tabs are rendered: "Conversation" and "History"

#### Scenario: Back to Board navigation
- **WHEN** user clicks "Back to Board"
- **THEN** the browser navigates to `/board`

### Requirement: Conversation messages have per-type visual styling

The system SHALL render conversation entries with type-specific visual styling using the existing status pill color scheme.

#### Scenario: Plan submission messages are purple
- **WHEN** a conversation entry has `messageType: "plan"`
- **THEN** it is rendered with a violet/purple left border and a purple badge labeled "Plan"

#### Scenario: Code submission messages are blue
- **WHEN** a conversation entry has `messageType: "code"`
- **THEN** it is rendered with a blue left border and a blue badge labeled "Code"

#### Scenario: Review submission messages are amber
- **WHEN** a conversation entry has `messageType: "review"`
- **THEN** it is rendered with an amber left border and an amber badge labeled "Review"

#### Scenario: User messages are neutral
- **WHEN** a conversation entry has `messageType: "user"`
- **THEN** it is rendered with a grey left border and a grey badge labeled "User"

#### Scenario: Agent messages are neutral (slightly distinct)
- **WHEN** a conversation entry has `messageType: "agent"`
- **THEN** it is rendered with a grey left border and a grey badge labeled "Agent"

#### Scenario: Merge messages are green
- **WHEN** a conversation entry has `messageType: "merge"`
- **THEN** it is rendered with a green left border and a green badge labeled "Merge"

#### Scenario: System messages are muted
- **WHEN** a conversation entry has `messageType: "system"`
- **THEN** it is rendered with muted italic styling

### Requirement: ConversationEntry type includes messageType field

The shared `ConversationEntry` type SHALL include a `messageType` field to enable per-type rendering.

#### Scenario: messageType is present on all entries
- **WHEN** the API returns a task with conversation entries
- **THEN** each entry includes a `messageType` string field

### Requirement: Backend tags entries with message type

The backend SHALL tag each conversation entry with the appropriate `messageType` at creation time.

#### Scenario: submit-plan creates "plan" type entry
- **WHEN** the backend processes a `submit-plan` action
- **THEN** the conversation entry is tagged with `messageType: "plan"`

#### Scenario: submit-code creates "code" type entry
- **WHEN** the backend processes a `submit-code` action
- **THEN** the conversation entry is tagged with `messageType: "code"`

#### Scenario: submit-review creates "review" type entry
- **WHEN** the backend processes a `submit-review` action
- **THEN** the conversation entry is tagged with `messageType: "review"`

#### Scenario: submit-merge creates "merge" type entry
- **WHEN** the backend processes a `submit-merge` action
- **THEN** the conversation entry is tagged with `messageType: "merge"`

#### Scenario: User actions create "user" type entry
- **WHEN** the backend processes a user action (approve plan, approve code, request changes, cancel)
- **THEN** the conversation entry is tagged with `messageType: "user"`

### Requirement: History tab shows status transitions

The history tab SHALL display task status transitions in chronological order.

#### Scenario: History tab displays transitions
- **WHEN** the user selects the "History" tab
- **THEN** status transitions are shown with timestamp, arrow, and new status label
