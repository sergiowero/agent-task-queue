## 1. Type System Update

- [x] 1.1 Rename `TaskStatus.New = "new"` to `TaskStatus.PlanRequested = "plan_requested"` in `packages/shared/src/types.ts`

## 2. Database Layer

- [x] 2.1 Update the default value in the CREATE TABLE schema from `'new'` to `'plan_requested'` in `packages/shared/src/database.ts`
- [x] 2.2 Add a migration query to update existing tasks: `UPDATE tasks SET status = 'plan_requested' WHERE status = 'new'` in `packages/shared/src/database.ts`

## 3. CLI (Claim Logic)

- [x] 3.1 Update the planner claim query to search for `"plan_requested"` status instead of `"new"` in `packages/cli/src/index.ts`

## 4. Web UI

- [x] 4.1 Update the `statuses` array in `packages/web-ui/src/pages/BoardPage.tsx` from `"new"` to `"plan_requested"`
- [x] 4.2 Update the `statuses` array in `packages/web-ui/src/components/TaskDrawer.tsx` from `"new"` to `"plan_requested"`

## 5. Spec Updates

- [x] 5.1 Update `openspec/specs/shared-entities/spec.md` — change TaskStatus enum value and database default
- [x] 5.2 Update `openspec/specs/workflow-transitions/spec.md` — update agent claim scenarios from "New" to "PlanRequested"
- [x] 5.3 Update `openspec/specs/web-portal/spec.md` — update board column mapping references
- [x] 5.4 Update `openspec/specs/task-management/spec.md` — update create task default status

## 6. Project Documentation

- [x] 6.1 Update `project.md` — update any references to "new" status in examples or schema descriptions

## 7. Verification

- [x] 7.1 Run TypeScript compilation to verify no type errors
- [x] 7.2 Search the codebase for any remaining references to `"new"` status string and fix them
