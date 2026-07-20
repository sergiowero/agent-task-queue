## Context

The ATQ Kanban board shows four columns (Pending, In Progress, Need Review, Done) grouping tasks by workflow status. Within each column, tasks appear in database insertion order. The `priority` field exists on the Task model and is used by the agent claim system (`getNextClaimableTask` orders by `priority DESC`) and displayed as a badge on TaskCard, but has no effect on visual ordering.

The change unifies visual ordering with the existing priority field, and provides inline editing of priority values as the reordering mechanism.

## Goals / Non-Goals

**Goals:**
- Tasks sorted by `priority DESC` within each board column (highest value at top)
- Tiebreaker: `created_at ASC` (oldest task first when priorities match)
- Priority badge on TaskCard is editable inline — click to edit, save on blur/enter
- Backend `getTasks` returns tasks ordered by `priority DESC, created_at ASC` by default
- Reordering happens by changing priority values, not by drag-and-drop

**Non-Goals:**
- No drag-and-drop reordering — explicitly excluded and any related code/dependencies removed
- No new `columnPosition`, `sortOrder`, or ordering field
- No changes to the claim logic (`getNextClaimableTask` already uses priority correctly)
- No changes to priority range, data type, or validation
- No multi-user conflict resolution — last write wins (consistent with existing patterns)

## Decisions

### Decision: Sort within columns on the frontend, not the backend

Tasks are already fetched in one batch and filtered per column on the frontend. Adding a sort step inside `useMemo` is simpler than changing the API contract.

**Rationale**: The board already groups tasks by column in a `useMemo`. Adding `.sort()` there is a 1-line change, zero API coupling, and consistent with how the board works. The backend sort in `getTasks` is a secondary improvement for CLI and general consistency.

**Alternatives considered**:
- Server-side sorting by column: Would require the API to understand column groupings, adding unnecessary complexity.
- New API endpoint with sort params: Overkill for a static sort.

### Decision: Inline editing on click with input field

Clicking the priority badge replaces it with a number input. Blur or Enter saves via `PUT /api/tasks/:id`. Escape cancels. The card repositions on the next SSE update or query invalidation.

**Rationale**: Standard inline-edit pattern. The priority badge already occupies a natural slot in the card layout — no layout redesign needed. The SSE system already broadcasts task updates, so the board re-sorts automatically after save.

**Alternatives considered**:
- Right-click context menu: Higher discoverability cost.
- Modal or drawer edit: Too much friction for a single-number change.
- Drag-and-drop: Explicitly rejected by design.

### Decision: No optimistic UI for card repositioning

After saving a new priority, the board re-sorts on the next SSE event or query invalidation. No client-side re-sort before the server confirms.

**Rationale**: Since SSE already triggers `queryClient.invalidateQueries`, the board updates within milliseconds. Optimistic updates add complexity (reverting on error, race conditions) with negligible UX benefit given the existing SSE infrastructure.

### Decision: Show priority badge for all values (including 0)

Currently the badge only renders when `priority > 0`. Since priority is now the ordering mechanism, hiding it for 0-priority tasks removes the user's ability to understand why tasks are ordered as they are.

**Rationale**: If priority determines position, every card should display its priority value, even if 0. This makes the ordering transparent.

## Risks / Trade-offs

- **Consecutive integer collision**: Two tasks with the same priority are ordered by created_at. Users who want precise ordering between adjacent values must use wider gaps. This is a minor UX subtlety, not a bug.
- **Priority and claim order coupling**: Changing a task's priority to reorder it also changes when agents claim it. This is intentional and desirable — what the user sees at the top SHOULD be claimed first. But it's worth noting that priority is no longer a purely aesthetic field.
- **SSE cascade**: Each priority change triggers an SSE broadcast, which invalidates the task query on all connected clients. With many concurrent users, rapid priority changes could cause excess re-fetches. Mitigation: debounce SSE events is already handled by react-query's built-in cache behavior.
