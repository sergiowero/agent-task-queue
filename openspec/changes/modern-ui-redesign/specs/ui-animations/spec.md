## ADDED Requirements

### Requirement: Theme transition animation
The system SHALL animate the transition between light and dark themes with a smooth color change.

#### Scenario: Theme switches with transition
- **WHEN** user toggles theme
- **THEN** all color properties transition smoothly over 300ms ease-in-out, no abrupt color jumps

### Requirement: Task drawer animation
The system SHALL animate the task detail drawer opening and closing with a slide effect.

#### Scenario: Drawer slides in from right
- **WHEN** user clicks a task card
- **THEN** drawer slides in from the right edge over 250ms with ease-out timing

#### Scenario: Drawer slides out to right
- **WHEN** user closes the task drawer
- **THEN** drawer slides out to the right edge over 250ms with ease-in timing

### Requirement: Modal fade animation
The system SHALL animate modal appearance and disappearance with a fade effect.

#### Scenario: Modal fades in
- **WHEN** user opens the create task modal
- **THEN** modal fades in from opacity 0 to 1 over 200ms with slight scale from 0.95 to 1

#### Scenario: Modal fades out
- **WHEN** user closes or cancels the modal
- **THEN** modal fades out from opacity 1 to 0 over 200ms

### Requirement: Button hover and focus states
The system SHALL provide visual feedback on button hover and focus interactions.

#### Scenario: Button hover effect
- **WHEN** user hovers over a button
- **THEN** button background color transitions over 150ms and shows a subtle lift effect via shadow

#### Scenario: Button focus ring
- **WHEN** user focuses a button via keyboard
- **THEN** button displays a visible focus ring with primary color border

### Requirement: Task card hover effect
The system SHALL provide visual feedback when hovering over task cards.

#### Scenario: Card hover lift
- **WHEN** user hovers over a task card
- **THEN** card elevates slightly with shadow transition over 150ms

### Requirement: Smooth theme variable application
The system SHALL ensure CSS variable transitions apply to all themed elements simultaneously.

#### Scenario: All elements transition together
- **WHEN** theme changes
- **THEN** all elements using CSS variables update their colors in a single coordinated transition
