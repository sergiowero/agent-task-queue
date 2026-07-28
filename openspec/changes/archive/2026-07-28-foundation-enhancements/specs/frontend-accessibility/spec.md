## ADDED Requirements

### Requirement: Modal focus trapping
All modals in the application SHALL trap keyboard focus within the modal dialog when open.

#### Scenario: Focus stays in modal
- **WHEN** a modal is open and the user presses Tab
- **THEN** the focus cycles through modal elements without reaching the background page

#### Scenario: Escape closes modal
- **WHEN** a modal is open and the user presses Escape
- **THEN** the modal closes

### Requirement: ARIA attributes on dialogs
All modal dialogs SHALL have `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing to the dialog title.

#### Scenario: Screen reader identifies dialog
- **WHEN** a screen reader is active and a modal opens
- **THEN** it announces the dialog title and that a modal dialog is open

### Requirement: Error boundaries
Each route SHALL be wrapped in a React Error Boundary that displays a fallback UI on error.

#### Scenario: Route error shows fallback
- **WHEN** a component in a route throws during render
- **THEN** the error boundary catches it and displays a "Something went wrong" message with a retry button
