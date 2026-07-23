## MODIFIED Requirements

### Requirement: Task detail drawer
The system SHALL render task details in a full-page view at `/tasks/:id/details` with action buttons and a conversation input inside the Conversation tab.

#### Scenario: Conversation tab has text input and inline buttons
- **WHEN** user views the Conversation tab on the task detail page
- **THEN** system displays a sticky footer at the bottom of the tab with a text input and a context-sensitive action button

#### Scenario: Cancel button always visible
- **WHEN** user views any task on the detail page
- **THEN** "Cancel Task" button is always shown at the bottom of the page
- **WHEN** user clicks Cancel
- **THEN** system transitions the task to Canceled, clears the assigned agent, and adds a conversation entry

#### Scenario: Request Plan Changes button in conversation tab
- **WHEN** task status is Waiting Plan Review
- **THEN** conversation tab shows "Request Plan Changes" button to the right of the text input
- **WHEN** user clicks it
- **THEN** system adds the input text to conversation and transitions to Plan Changes Requested

#### Scenario: Request Changes button in conversation tab
- **WHEN** task status is Waiting Code Review
- **THEN** conversation tab shows "Request Changes" button to the right of the text input
- **WHEN** user clicks it
- **THEN** system adds the input text to conversation and transitions to Changes Requested

#### Scenario: Add Comment button in conversation tab
- **WHEN** task status is Planning, Coding, Ready for Code, Reviewing, Merged, or Complete
- **THEN** conversation tab shows "Add Comment" button to the right of the text input
- **WHEN** user clicks it
- **THEN** system adds the input text as a plain user message to conversation with no status change

#### Scenario: Approve Plan button in action bar
- **WHEN** task status is Waiting Plan Review
- **THEN** bottom action bar shows "Approve Plan" button
- **WHEN** user clicks it
- **THEN** system transitions the task to Ready for Code and adds a conversation entry

#### Scenario: Approve button in action bar
- **WHEN** task status is Waiting Code Review
- **THEN** bottom action bar shows "Approve" button in green
- **WHEN** user clicks it
- **THEN** system transitions the task to Approved and adds a conversation entry

#### Scenario: Request AI Review button in action bar
- **WHEN** task status is Waiting Code Review
- **THEN** bottom action bar shows "Request AI Review" button in blue
- **WHEN** user clicks it
- **THEN** system transitions the task to Code Review Requested and adds a conversation entry

#### Scenario: Complete button in action bar
- **WHEN** task status is Merged
- **THEN** bottom action bar shows "Complete" button
- **WHEN** user clicks it
- **THEN** system transitions the task to Complete
