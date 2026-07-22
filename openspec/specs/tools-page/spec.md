## ADDED Requirements

### Requirement: Tools page displays available tools as cards
The system SHALL display a grid of tool cards on the `/tools` route, where each card shows the tool name and description.

#### Scenario: User navigates to tools page
- **WHEN** user clicks "Tools" in the sidebar navigation
- **THEN** system displays a grid of tool cards with name and description for each tool

### Requirement: Tool cards navigate to tool detail page
The system SHALL navigate to the tool's dedicated page when a user clicks on a tool card.

#### Scenario: User clicks a tool card
- **WHEN** user clicks on a tool card
- **THEN** system navigates to `/tools/{toolId}` and displays the tool's interface

### Requirement: Tools page is accessible from sidebar navigation
The system SHALL include a "Tools" entry in the sidebar navigation menu.

#### Scenario: Sidebar shows tools link
- **WHEN** user views the sidebar
- **THEN** a "Tools" link is visible and navigates to `/tools`
