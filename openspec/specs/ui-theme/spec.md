# UI Theme

Light and dark theme system with CSS custom properties, user toggle control, and system preference detection.

## Requirements

### Requirement: Theme toggle control

The system SHALL provide a visible toggle control that allows users to switch between light and dark themes.

#### Scenario: Toggle displays current theme
- **WHEN** user views the application header
- **THEN** system displays a theme toggle button showing sun icon in light mode and moon icon in dark mode

#### Scenario: Toggle switches theme on click
- **WHEN** user clicks the theme toggle button
- **THEN** system switches to the opposite theme and persists the selection to localStorage

#### Scenario: Theme persists across sessions
- **WHEN** user selects a theme and reloads the page
- **THEN** system applies the previously selected theme on page load

### Requirement: System preference detection

The system SHALL detect and apply the user's operating system color scheme preference when no explicit theme is selected.

#### Scenario: Default theme matches system preference
- **WHEN** user has no saved theme preference in localStorage
- **THEN** system applies light theme if OS preference is light, dark theme if OS preference is dark

#### Scenario: System preference changes
- **WHEN** user changes OS color scheme preference and no explicit theme is saved
- **THEN** system automatically applies the new system preference

### Requirement: Theme CSS variables

The system SHALL define all theme colors using CSS custom properties that change based on the active theme.

#### Scenario: Light theme variables active
- **WHEN** light theme is active
- **THEN** CSS variables on `:root` provide light color values for surface, text, primary, secondary, border, and other design tokens

#### Scenario: Dark theme variables active
- **WHEN** dark theme is active
- **THEN** CSS variables on `[data-theme="dark"]` provide dark color values for all design tokens

### Requirement: Theme flash prevention

The system SHALL prevent flash of unstyled content on initial page load by setting theme before React mounts.

#### Scenario: Theme applied before first render
- **WHEN** page loads for the first time with a saved dark theme preference
- **THEN** `data-theme` attribute is set on `<html>` before any content renders, preventing white flash
