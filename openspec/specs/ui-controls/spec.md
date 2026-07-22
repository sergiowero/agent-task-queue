# UI Controls

Modern button, input, badge, and toggle components with consistent styling and accessibility.

## Requirements

### Requirement: Modern button design

The system SHALL render all buttons with consistent modern styling including rounded corners, padding, and color hierarchy.

#### Scenario: Primary button styling
- **WHEN** a button has variant="primary"
- **THEN** button displays with primary theme color background, white text, rounded-lg corners, and hover/focus states

#### Scenario: Secondary button styling
- **WHEN** a button has variant="secondary"
- **THEN** button displays with transparent background, primary color border, primary color text, and hover fill effect

#### Scenario: Danger button styling
- **WHEN** a button has variant="danger"
- **THEN** button displays with danger/red theme color background and hover darkening

### Requirement: Modern input design

The system SHALL render all text inputs with consistent modern styling.

#### Scenario: Input base styling
- **WHEN** a text input is rendered
- **THEN** input displays with rounded-lg corners, border, background color matching theme surface, and padding

#### Scenario: Input focus state
- **WHEN** user focuses a text input
- **THEN** input border transitions to primary color with subtle glow ring

#### Scenario: Input error state
- **WHEN** input has an error
- **THEN** input displays with danger/red border color and error message below

### Requirement: Modern badge design

The system SHALL render status and priority badges with pill-shaped styling and theme-aware colors.

#### Scenario: Status badge colors
- **WHEN** a task status badge is rendered
- **THEN** badge displays with color coding matching the status (green for done, yellow for in progress, etc.)

#### Scenario: Priority badge styling
- **WHEN** a priority badge is rendered
- **THEN** badge displays as pill shape with priority value and appropriate color intensity

### Requirement: Modern toggle control

The system SHALL render toggle switches with a sliding dot animation.

#### Scenario: Toggle off state
- **WHEN** a toggle is in the off position
- **THEN** toggle displays with gray background and dot on the left

#### Scenario: Toggle on state
- **WHEN** a toggle is in the on position
- **THEN** toggle displays with primary color background and dot on the right with smooth slide animation

### Requirement: Consistent focus management

The system SHALL provide visible keyboard focus indicators on all interactive elements.

#### Scenario: Focus ring on interactive elements
- **WHEN** user navigates to any button, input, toggle, or link via keyboard
- **THEN** element displays a 2px focus ring with primary color offset by 2px
