# Task Detail Page

Delta spec for the Context tab on the task detail page.

## ADDED Requirements

### Requirement: Task detail page has a Context tab
The task detail page at `/tasks/:id/details` SHALL have a third tab labeled "Context" alongside the existing "Conversation" and "History" tabs.

#### Scenario: Context tab is present
- **WHEN** the task detail page loads
- **THEN** three tabs are rendered: "Conversation", "Context", "History" in that order

#### Scenario: Context tab shows entries
- **WHEN** the user selects the "Context" tab and the task has context entries
- **THEN** each context entry is displayed as a card with its entry number (`#1`, `#2`, ...) and the text content

#### Scenario: Context tab shows empty state
- **WHEN** the user selects the "Context" tab and the task has no context entries
- **THEN** a message "No context entries recorded" is displayed

### Requirement: Context tab styling
Context entries SHALL have distinct visual styling from conversation messages. Each entry SHALL be rendered with a neutral/blue left border and the entry index as a badge.

#### Scenario: Context entry card style
- **WHEN** a context entry is rendered
- **THEN** it has a blue left border, a badge showing `#N`, and the entry text
