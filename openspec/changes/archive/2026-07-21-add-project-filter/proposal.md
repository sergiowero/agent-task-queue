## Why

The board view currently only supports filtering by project through sidebar navigation, which requires leaving the board context. Users need a quick way to switch between projects or view all tasks directly from the board's top bar, consistent with the existing status and agent filters.

## What Changes

- Add a project filter dropdown to the board top bar, alongside the existing status and agent filters
- Populate the dropdown with all available projects from the API
- Include an "All projects" option to clear the filter
- Sync the selected project with the URL search param (`projectId`) for deep-linking support
- Update the board to re-fetch tasks when the project filter changes

## Capabilities

### New Capabilities

_(none — this extends existing web-portal behavior)_

### Modified Capabilities

- `web-portal`: Add project filter dropdown to the board top bar; update the "Filter tasks by project" scenario to cover the dropdown UI

## Impact

- `packages/web-ui/src/pages/BoardPage.tsx` — add project filter state, dropdown UI, and sync with URL params
- `packages/web-ui/src/lib/api.ts` — already supports `getProjects()` and `getTasks(projectId)`, no changes needed
- No API or backend changes required
