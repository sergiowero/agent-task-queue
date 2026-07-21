## Context

The ATQ task workflow uses a `TaskStatus` enum with 15 states. The initial state for newly created tasks is `New` (string value `"new"`). This name is generic and doesn't communicate what the task is waiting for — which is a plan before work can begin.

The system already has statuses like `PlanChangesRequested`, `CodeReviewRequested`, and `ChangesRequested` that follow a `[Action] Requested` naming pattern. Renaming `New` to `PlanRequested` aligns with this established convention and makes the workflow self-documenting.

## Goals / Non-Goals

**Goals:**
- Rename `TaskStatus.New` to `TaskStatus.PlanRequested` with string value `"plan_requested"`
- Update all code references, specs, and database defaults
- Migrate existing tasks in the database from `"new"` to `"plan_requested"`
- Maintain backward compatibility during migration (no downtime)

**Non-Goals:**
- Changing any workflow logic or transitions
- Renaming other status values
- Adding new statuses

## Decisions

### Decision: String value `"plan_requested"` (not `"plan-requested"` or `"planRequested"`)

Use snake_case for the string value to match the existing convention in `TaskStatus` (`waiting_plan_review`, `plan_changes_requested`, etc.).

**Alternative considered**: `"plan-requested"` (kebab-case) — rejected because existing values use snake_case.
**Alternative considered**: `"planRequested"` (camelCase) — rejected because existing values use snake_case.

### Decision: Database migration via UPDATE statement

Run a single `UPDATE tasks SET status = 'plan_requested' WHERE status = 'new'` during startup or as a migration step. This is safe because the status column is TEXT and the transition is idempotent.

**Alternative considered**: Application-level migration in code — rejected because a SQL statement is simpler and less error-prone.

### Decision: No downtime required

Since this is a rename with a migration, existing tasks will be updated on startup. The old `"new"` string value will no longer be produced, but reading old data is handled by the migration.

## Risks / Trade-offs

- **[Risk] Existing tasks with `"new"` status** → Mitigated by running the UPDATE migration on startup before the application serves requests
- **[Risk] Third-party integrations or scripts referencing `"new"` string** → Document the rename; the CLI and web UI are the only interfaces
- **[Trade-off] Schema change requires coordination** → The enum rename is straightforward; the database column stays TEXT so no DDL change is needed
