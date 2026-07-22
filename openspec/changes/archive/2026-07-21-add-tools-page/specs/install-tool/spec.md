## ADDED Requirements

### Requirement: Install tool provides execution mode
The install tool page SHALL offer an "Execute" option that runs the ATQ install script via the backend API and streams the output in real-time.

#### Scenario: User executes install script
- **WHEN** user clicks "Execute Install" button
- **THEN** system sends request to `/api/tools/install/execute` and displays streaming output via SSE

### Requirement: Install tool provides manual copy mode
The install tool page SHALL display the `atq-workflow` skill file content with a copy-to-clipboard button as a fallback.

#### Scenario: User views skill file content
- **WHEN** user navigates to `/tools/install`
- **THEN** system displays the skill file markdown content and a "Copy" button

#### Scenario: User copies skill file
- **WHEN** user clicks "Copy" button
- **THEN** skill file content is copied to clipboard and button shows "Copied!" confirmation

### Requirement: Install tool handles execution errors gracefully
The system SHALL display an error message if script execution fails and automatically show the manual copy fallback.

#### Scenario: Script execution fails
- **WHEN** install script execution returns an error
- **THEN** system displays the error message and shows the skill file content with copy button

### Requirement: Backend endpoint executes install script
The system SHALL provide a `POST /api/tools/install/execute` endpoint that runs the install script and returns output via SSE.

#### Scenario: Backend executes install script
- **WHEN** backend receives POST request to `/api/tools/install/execute`
- **THEN** system executes `bun run install:bin` and `bun run install:skills` and streams stdout/stderr as SSE events
