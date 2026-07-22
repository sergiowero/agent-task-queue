## 1. Board Project Filter

- [x] 1.1 Add `projectFilter` state to `BoardPage.tsx` and initialize from `projectId` search param
- [x] 1.2 Add `useQuery` for projects list using `api.getProjects()`
- [x] 1.3 Add project filter `<select>` dropdown to the top bar, positioned after the agent filter
- [x] 1.4 Populate dropdown with "All projects" option plus all projects (using `displayName`)
- [x] 1.5 Sync dropdown selection with URL search params via `setSearchParams` on change
- [x] 1.6 Verify board re-fetches tasks when project filter changes (React Query key includes `projectId`)

## 2. Verification

- [x] 2.1 Test: Selecting a project shows only that project's tasks
- [x] 2.2 Test: Selecting "All projects" shows all tasks
- [x] 2.3 Test: Deep link with `?projectId=xxx` pre-selects the correct project
- [x] 2.4 Test: Browser back/forward navigates between project filter states
