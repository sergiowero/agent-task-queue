## ADDED Requirements

### Requirement: Focus trap in modals
All modal components SHALL trap keyboard focus within the modal when open.

#### Scenario: Tab cycles inside modal
- **WHEN** a modal is open and user presses Tab
- **THEN** focus cycles through all focusable elements inside the modal without leaving it

#### Scenario: Escape closes modal
- **WHEN** a modal is open and user presses Escape
- **THEN** the modal closes

### Requirement: ARIA attributes on modals
All modal overlays SHALL include `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` referencing the modal title.

#### Scenario: Modal is accessible
- **WHEN** a screen reader is active and a modal opens
- **THEN** it announces the dialog role, modal state, and title

### Requirement: Error boundary for routes
Each route SHALL be wrapped in a React Error Boundary that catches rendering errors and displays a fallback UI.

#### Scenario: Route error caught
- **WHEN** a component throws during render
- **THEN** the error boundary displays "Something went wrong" with a retry button
