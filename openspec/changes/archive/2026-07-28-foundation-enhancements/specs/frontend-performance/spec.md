## ADDED Requirements

### Requirement: SSE direct cache update
The SSE hook SHALL update the TanStack Query cache directly for specific task events instead of invalidating all task queries.

#### Scenario: Task update patches cache
- **WHEN** an SSE `task_updated` event is received
- **THEN** the hook uses `queryClient.setQueryData` to update the specific task in the cache

#### Scenario: Task created adds to list
- **WHEN** an SSE `task_created` event is received
- **THEN** the hook prepends the new task to the task list query cache

### Requirement: Remove duplicate polling
The TaskDetailPage SHALL NOT use `refetchInterval` since SSE already provides real-time updates.

#### Scenario: No polling on detail page
- **WHEN** the TaskDetailPage is rendered
- **THEN** it does not poll the server; updates come only via SSE

### Requirement: RAF cleanup in TaskCard
The `requestAnimationFrame` call in TaskCard SHALL be cancelled on unmount using `cancelAnimationFrame`.

#### Scenario: Unmount cancels RAF
- **WHEN** the TaskCard unmounts while the priority input is about to focus
- **THEN** no stale callback fires

### Requirement: Stable list keys
List items SHALL use stable, unique keys (not array indices) for correct React reconciliation.

#### Scenario: Conversation uses stable keys
- **WHEN** conversation entries are rendered
- **THEN** each entry uses `authorName + timestamp` as its key
