## Context

The board view (`BoardPage.tsx`) already supports filtering tasks by project via URL search param (`?projectId=xxx`). The sidebar lists projects and navigates to the board with this param. However, there is no in-board dropdown to change or clear the project filter without navigating away from the board. The top bar currently has search, status filter, and agent filter — but no project filter.

## Goals / Non-Goals

**Goals:**
- Add a project filter dropdown to the board top bar, consistent with existing filter UI
- Allow users to select a project, switch projects, or view all tasks from the board
- Sync the selected project with the URL search param for deep-linking
- Re-fetch tasks when the project filter changes

**Non-Goals:**
- Changing the sidebar project list behavior
- Adding multi-project filtering
- Backend changes (API already supports `?projectId=`)

## Decisions

### Use a `<select>` dropdown matching existing filter style
**Decision**: Add a `<select>` element styled identically to the status and agent filter dropdowns.

**Rationale**: Consistency with existing UI patterns. The board already has two filter dropdowns with the same styling — a third one follows the established convention. No need for a custom component.

**Alternatives considered**:
- Combobox with search: Overkill for the current project count (< 10 projects typically)
- Multi-select: Adds complexity without clear user need; can be added later

### Fetch projects in BoardPage via existing `api.getProjects()`
**Decision**: Use the existing `useQuery` + `api.getProjects()` pattern (already used in `Layout.tsx`) to populate the dropdown.

**Rationale**: The projects data is already available through the API and the query is cached by React Query. No new API surface needed.

### Sync dropdown state with URL search params
**Decision**: Read `projectId` from `useSearchParams()` (already in use) and update it when the dropdown changes.

**Rationale**: Preserves deep-linking and browser back/forward behavior. The existing code already reads `projectId` from search params — the dropdown just needs to write back to it.

## Risks / Trade-offs

- **Risk**: Projects list fetch adds a small network request on board load. **Mitigation**: React Query caches the result; the request is already made by the sidebar, so the cache is likely warm.
- **Trade-off**: The dropdown shows project `displayName` but stores `id`. If two projects have the same display name, the user must distinguish them by context. This is acceptable for the typical project count.
