## Why

The Kanban board displays tasks grouped by status columns but has no meaningful ordering within columns. Tasks appear in arbitrary insert order, making the board less useful for planning and prioritization. Priority already exists as a field with semantic meaning — it drives agent claim order — but is ignored for visual ordering. Unifying these two uses of priority makes the board reflect real importance at a glance, and lets users reorder tasks simply by adjusting priority numbers inline.

## What Changes

- Tasks within each board column are sorted by `priority DESC, created_at ASC` (highest priority at top)
- The priority badge on TaskCard becomes editable inline (click to edit, blur/enter to save)
- No drag-and-drop reordering — reordering is done by changing priority values
- No new `columnPosition` or ordering field — `priority` is the single source of truth for both claim order and visual order
- Backend `getTasks` adds `ORDER BY priority DESC, created_at ASC` for consistent default ordering

## Capabilities

### New Capabilities

None — this change modifies existing behavior only.

### Modified Capabilities

- `web-portal`: Board columns must sort tasks by priority descending within each column. Task cards must support inline priority editing.
- `task-management`: Task retrieval must return tasks ordered by priority descending by default.

## Impact

- `packages/web-ui/src/pages/BoardPage.tsx` — add sort within column groupings
- `packages/web-ui/src/components/TaskCard.tsx` — make priority badge editable inline
- `packages/shared/src/database.ts` — add `ORDER BY priority DESC, created_at ASC` to `getTasks`
- No API changes — `PUT /tasks/:id` already supports priority updates
- No schema changes — `priority` column already exists
- No new dependencies
