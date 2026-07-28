## ADDED Requirements

### Requirement: All pages use theme CSS variables
Every page SHALL use CSS variable-based Tailwind classes (e.g., `text-text-secondary`, `border-border`) instead of hardcoded color classes (e.g., `text-gray-500`, `border-gray-100`) to ensure dark mode support.

#### Scenario: ActivityPage dark mode
- **WHEN** dark theme is active and user navigates to ActivityPage
- **THEN** all text, borders, and backgrounds use theme-appropriate colors (no hardcoded grays)

#### Scenario: BoardPage dark mode
- **WHEN** dark theme is active and user views the board
- **THEN** column headers, task cards, and filters display with theme-correct colors
