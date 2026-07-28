## ADDED Requirements

### Requirement: Toast feedback on actions
Task detail page actions SHALL display a toast notification on success or failure.

#### Scenario: Approve shows success toast
- **WHEN** user clicks "Approve Plan" and it succeeds
- **THEN** a green toast appears with "Plan approved"

#### Scenario: Cancel shows success toast
- **WHEN** user clicks "Cancel Task" and it succeeds
- **THEN** a green toast appears with "Task canceled"

### Requirement: Stable conversation entry keys
Conversation entries SHALL use stable keys (authorName + timestamp combination) instead of array index.

#### Scenario: Conversation entries have stable keys
- **WHEN** conversation entries are rendered
- **THEN** each entry uses `entry.timestamp + entry.authorName` as its React key

## MODIFIED Requirements

### Requirement: Task detail page data fetching
The system SHALL fetch task data via TanStack Query with SSE as the sole real-time update mechanism (no polling).

#### Scenario: Task detail loads via query
- **WHEN** the task detail page loads
- **THEN** data is fetched once via react-query with `staleTime: 30000` and no `refetchInterval`
- **THEN** subsequent updates come exclusively from SSE events
