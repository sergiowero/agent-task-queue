## MODIFIED Requirements

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
