## ADDED Requirements

### Requirement: Loading skeleton animations
List and detail pages SHALL display animated skeleton placeholders while data is loading.

#### Scenario: Task card skeletons
- **WHEN** task list is loading on the board
- **THEN** each column shows 3 animated placeholder cards with `animate-pulse` effect

#### Scenario: Task detail skeleton
- **WHEN** task detail page is loading
- **THEN** the page shows animated placeholder blocks for the header, metadata grid, and tab content area

### Requirement: Empty state animations
Empty states SHALL include a relevant illustration/icon with fade-in animation.

#### Scenario: Empty board animation
- **WHEN** no tasks exist
- **THEN** a centered empty state with icon and text fades in with `animate-fade-in`
