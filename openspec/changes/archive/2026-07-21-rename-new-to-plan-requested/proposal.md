## Why

The current initial task status is named "New", which is vague and doesn't convey what the task is actually waiting for. In the ATQ workflow, a newly created task needs a plan before work can begin. Renaming "New" to "Plan Requested" aligns the status name with the ubiquitous language used throughout the system — it makes it immediately clear that the task is awaiting planning.

## What Changes

- Rename `TaskStatus.New` enum value from `"new"` to `"plan_requested"` in `shared-entities`
- Update the database schema default from `'new'` to `'plan_requested'`
- Update all workflow transition references from "New" to "Plan Requested"
- Update board column mapping in the web portal to use the new status name
- Update CLI claim logic that queries for "new" status tasks
- Update UI components that reference the "new" status

## Capabilities

### New Capabilities

None — this is a renaming of an existing capability, not a new one.

### Modified Capabilities

- `shared-entities`: TaskStatus enum value renamed from New to PlanRequested; database schema default updated
- `workflow-transitions`: All agent claim scenarios referencing "New status" updated to "Plan Requested"
- `web-portal`: Board column mapping updated to include Plan Requested in the Pending column
- `task-management`: Task creation default status updated in documentation

## Impact

- **Breaking change**: Database migration needed for existing tasks with status `'new'`
- **Code changes**: `packages/shared/src/types.ts`, `packages/shared/src/database.ts`, `packages/cli/src/index.ts`, `packages/web-ui/src/pages/BoardPage.tsx`, `packages/web-ui/src/components/TaskDrawer.tsx`
- **Spec changes**: `openspec/specs/shared-entities/spec.md`, `openspec/specs/workflow-transitions/spec.md`, `openspec/specs/web-portal/spec.md`
