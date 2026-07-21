## Why

The current "ready" state name is ambiguous — it doesn't communicate what the task is ready for. Renaming it to "ready for code" makes the workflow clearer: a task in this state is ready for an implementer to start coding. This improves agent and user understanding of the task lifecycle.

## What Changes

**BREAKING**: Renames the `TaskStatus.Ready` enum member and its string value from `"ready"` to `"ready for code"`.

- Update the `TaskStatus` enum in `packages/shared/src/types.ts`
- Update all code references: claim logic, task creation, transitions, web UI columns
- Update the `atq-workflow` skill's phase intelligence table
- Update the `workflow-transitions` spec to reflect the new state name
- Update `project.md` documentation
- Apply database migration if state values are persisted

## Capabilities

### New Capabilities

None — this is a rename, not a new feature.

### Modified Capabilities

- `workflow-transitions`: State name changes from "Ready" to "Ready for Code" in all claim scenarios and transition specs
- `cli-claim`: Role-to-status mapping and claim transitions update the Ready state reference

## Impact

- **Code**: `packages/shared/src/types.ts`, `packages/shared/src/database.ts`, `packages/cli/src/index.ts`, `packages/web/src/index.ts`, `packages/web-ui/src/pages/BoardPage.tsx`, `packages/web-ui/src/components/TaskDrawer.tsx`
- **Tests**: `packages/shared/src/database.test.ts`
- **Skills**: `skills/atq-workflow/SKILL.md`
- **Specs**: `openspec/specs/workflow-transitions/spec.md`
- **Docs**: `project.md`
- **Database**: May require migration if task statuses are persisted as strings
