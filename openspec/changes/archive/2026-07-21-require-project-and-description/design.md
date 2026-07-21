## Context

The ATQ system allows creating tasks via three surfaces: Web UI modal, REST API, and CLI. Currently, `project_id` is nullable in the database and optional in all consumers. `description` is optional in the database but the modal treats it as optional too. The `mergeBranch` field exists in the Task type and database but is not exposed in the creation modal — it always defaults to `"develop"`.

## Goals / Non-Goals

**Goals:**
- Every task must have a project, description, and a merge branch target at creation time
- Enforce constraints at all layers: API, CLI, and UI
- Expose `mergeBranch` in the creation modal

**Non-Goals:**
- Changing the task update flow (projects can still be reassigned later)
- Adding project CRUD to the modal (projects are created separately)
- Changing the database schema type (SQLite NOT NULL via ALTER TABLE is not reliable; enforce at app level)

## Decisions

### 1. App-level enforcement over schema migration

**Decision**: Enforce `project_id IS NOT NULL` in `createTask()` and the API handler, rather than attempting `ALTER TABLE ... NOT NULL` on SQLite.

**Why**: SQLite does not enforce `NOT NULL` on columns added via `ALTER TABLE`, and backfilling requires care. App-level validation is simpler, portable, and sufficient since all writes go through our code.

**Alternative considered**: Add a CHECK constraint via a new migration. Rejected — SQLite CHECK constraints on existing columns require table recreation.

### 2. mergeBranch defaults to "develop" in the modal

**Decision**: Pre-fill the merge branch input with `"develop"` but allow editing.

**Why**: Most tasks merge to develop. Pre-filling reduces friction while still allowing override for hotfixes or release branches.

### 3. Project dropdown in modal with "All projects" not allowed

**Decision**: The project selector in the modal is a required dropdown. It pre-selects the currently filtered project (from URL params). If no project filter is active, the dropdown starts empty, forcing the user to pick one.

**Why**: Consistent with the "project required" rule. Pre-selecting from the current filter is convenient.

## Risks / Trade-offs

- **[Risk] Existing API consumers break** → Mitigation: This is intentional (breaking change). Document in release notes.
- **[Risk] CLI users surprised by new required flag** → Mitigation: Commander shows clear error message when required option is missing.
- **[Trade-off] No DB-level constraint** → App-level validation is sufficient since all writes go through our code, but a direct SQLite manipulation would bypass it. Acceptable for this system.
