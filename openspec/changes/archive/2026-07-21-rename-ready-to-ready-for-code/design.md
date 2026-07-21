## Context

The ATQ task workflow uses a `TaskStatus` enum to track task lifecycle states. The current `Ready` state (string value `"ready"`) represents tasks that are ready for an implementer to begin coding. However, the name "ready" is ambiguous — it could mean ready for planning, ready for review, or ready for anything.

The state is referenced across:
- TypeScript enum definition (`packages/shared/src/types.ts`)
- Database query logic (`packages/shared/src/database.ts`)
- CLI claim logic with role-to-status mapping (`packages/cli/src/index.ts`)
- Web server transition handlers (`packages/web/src/index.ts`)
- Web UI Kanban board columns and active status sets (`packages/web-ui/`)
- Agent workflow skill (`skills/atq-workflow/SKILL.md`)
- Specification documents (`openspec/specs/`)

## Goals / Non-Goals

**Goals:**
- Rename `TaskStatus.Ready` to `TaskStatus.ReadyForCode` with string value `"ready for code"`
- Update all code references to use the new enum member and string value
- Update documentation, specs, and skills to reflect the new name
- Ensure claim logic continues to work correctly after the rename
- Apply any necessary database migrations

**Non-Goals:**
- Changing the behavior of the Ready state (only renaming)
- Modifying other task states
- Refactoring the claim logic or workflow transitions

## Decisions

### Decision 1: Enum member naming — `ReadyForCode`

**Choice**: Rename `TaskStatus.Ready` to `TaskStatus.ReadyForCode`

**Rationale**: Follows the existing naming pattern in the enum (e.g., `WaitingPlanReview`, `ChangesRequested`, `CodeReviewRequested`). The "For" prefix clearly communicates purpose. The string value `"ready for code"` matches the member name in a human-readable way.

**Alternatives considered**:
- `ReadyToCode` — slightly less formal, doesn't match the "for" pattern used elsewhere
- `CodingReady` — implies the task is already in coding phase, which it isn't

### Decision 2: String value format — `"ready for code"` (space-separated)

**Choice**: Use `"ready for code"` as the string value, not `"ready-for-code"` or `"readyForCode"`

**Rationale**: The existing enum uses space-separated multi-word values (e.g., `"waiting plan review"`, `"changes requested"`, `"code review requested"`). Consistency with existing values is more important than URL-slug or camelCase conventions.

### Decision 3: Database migration strategy — in-place update

**Choice**: If task statuses are stored as strings in the database, run an UPDATE statement to change `"ready"` to `"ready for code"` in all existing task records.

**Rationale**: The string value is the persisted representation. A simple UPDATE is safe since this is a development/internal tool with minimal production data. No schema change needed — just a data migration.

**Alternatives considered**:
- Add a new state and deprecate old one — overkill for a rename, adds complexity
- No migration — would break existing tasks in Ready status

### Decision 4: Skill update — direct text replacement

**Choice**: Update the `atq-workflow` skill's phase intelligence table to reference `"ready for code"` instead of `"ready"`

**Rationale**: The skill instructs agents on how to interpret task statuses. The mapping must match the actual enum values.

## Risks / Trade-offs

**[Risk] Hardcoded string references** → Some code may use the string `"ready"` directly instead of the enum member. Mitigation: grep for `"ready"` in all TypeScript files and verify each reference is updated or uses the enum.

**[Risk] Test data uses raw strings** → Test files may create tasks with `"ready"` string directly. Mitigation: Update all test fixtures to use `"ready for code"` or the enum member.

**[Risk] Archived changes reference old state** → The archived rename proposal at `openspec/changes/archive/2026-07-21-rename-new-to-plan-requested/` references "Ready". Mitigation: Leave archived changes untouched — they represent historical decisions.
