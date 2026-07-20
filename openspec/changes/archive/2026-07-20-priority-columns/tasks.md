## 1. Backend: Default ordering in getTasks

- [x] 1.1 Add `ORDER BY priority DESC, created_at ASC` to the `getTasks` SQL query in `packages/shared/src/database.ts`
- [x] 1.2 Verify existing tests still pass — the order only matters visually, not for correctness

## 2. Frontend: Sort tasks within board columns

- [x] 2.1 Add a sort step inside the `grouped` `useMemo` in `BoardPage.tsx` — each column's task array sorted by `priority DESC, created_at ASC`
- [x] 2.2 Verify tasks appear in correct order on the board after sorting

## 3. Frontend: Inline priority editing on TaskCard

- [x] 3.1 Make the priority badge clickable — clicking it replaces the badge with an `<input type="number">` pre-filled with the current priority value
- [x] 3.2 Handle Enter: save the new priority via `api.updateTask(id, { priority })` and revert to badge view
- [x] 3.3 Handle Blur: same as Enter — save and revert
- [x] 3.4 Handle Escape: revert to badge view without saving
- [x] 3.5 Show a loading/saving state on the input to indicate the update is in flight
- [x] 3.6 Verify the card repositions in the column after SSE broadcasts the update

## 4. Frontend: Show priority badge for all values

- [x] 4.1 Remove the `task.priority > 0` guard in `TaskCard.tsx` so the badge renders for all priorities including 0
- [x] 4.2 Ensure priority 0 displays as "P0" on the badge

## 5. Remove drag-and-drop code

- [x] 5.1 Check `packages/web-ui/package.json` for any drag-and-drop dependencies (e.g., `@dnd-kit`, `react-beautiful-dnd`, `react-dnd`) and remove them if present
- [x] 5.2 Search the codebase for any drag-related code (`onDragStart`, `draggable`, `DragDropContext`, sortable) and remove it
- [x] 5.3 Verify no drag affordances exist on task cards (grab cursor, drag handles)
