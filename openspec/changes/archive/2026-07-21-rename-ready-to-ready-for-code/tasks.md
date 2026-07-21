## 1. Enum and Type Definitions

- [x] 1.1 Rename `TaskStatus.Ready` to `TaskStatus.ReadyForCode` in `packages/shared/src/types.ts` with string value `"ready for code"`
- [x] 1.2 Update the re-export in `packages/shared/src/index.ts` if needed

## 2. Database Layer

- [x] 2.1 Update `createTask()` in `packages/shared/src/database.ts` to use `TaskStatus.ReadyForCode` when `requiresPlan` is false
- [x] 2.2 Update `getNextClaimableTask()` query comments if they reference "ready"
- [x] 2.3 Add database migration to update existing `"ready"` strings to `"ready for code"` in task records

## 3. CLI Claim Logic

- [x] 3.1 Update `ROLE_STATUSES` mapping in `packages/cli/src/index.ts` to use `TaskStatus.ReadyForCode`
- [x] 3.2 Update `getClaimTransition()` to handle `TaskStatus.ReadyForCode` transition to Coding
- [x] 3.3 Update `getEffectiveRole()` to resolve `TaskStatus.ReadyForCode` to implementer role

## 4. Web Server Transitions

- [x] 4.1 Update the approve-plan transition in `packages/web/src/index.ts` to transition to `TaskStatus.ReadyForCode`

## 5. Web UI

- [x] 5.1 Update `COLUMNS` constant in `packages/web-ui/src/pages/BoardPage.tsx` to use `"ready for code"` in the pending column statuses
- [x] 5.2 Update `ACTIVE_STATUSES` Set in `packages/web-ui/src/components/TaskDrawer.tsx` to use `"ready for code"`

## 6. Tests

- [x] 6.1 Update all test cases in `packages/shared/src/database.test.ts` that create tasks in `TaskStatus.Ready` to use `TaskStatus.ReadyForCode`
- [x] 6.2 Run tests to verify claim logic works correctly with the renamed state

## 7. Skills and Documentation

- [x] 7.1 Update `skills/atq-workflow/SKILL.md` phase intelligence table to map `"ready for code"` to Coding phase
- [x] 7.2 Update `project.md` to reference "Ready for Code" instead of "Ready" in agent role descriptions

## 8. Specifications

- [x] 8.1 Archive delta specs from `openspec/changes/rename-ready-to-ready-for-code/specs/` into main specs
- [x] 8.2 Verify `openspec/specs/workflow-transitions/spec.md` reflects the new state name after archive
- [x] 8.3 Verify `openspec/specs/cli-claim/spec.md` reflects the new state name after archive

## 9. Verification

- [x] 9.1 Run `npm run lint` to check for any linting errors
- [x] 9.2 Run `npm run typecheck` to verify type safety across all packages
- [x] 9.3 Run full test suite to confirm claim logic and transitions work as expected
