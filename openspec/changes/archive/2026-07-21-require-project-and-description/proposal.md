## Why

Task creation currently allows orphan tasks with no project or description, leading to unorganized work that agents cannot properly scope. Every task must belong to a project for context, and a description is needed for agents to understand the work. Additionally, the modal is missing the `mergeBranch` field, forcing all tasks to default to "develop" with no way to override at creation time.

## What Changes

- **BREAKING**: Project becomes a required field for task creation (database, API, CLI, UI)
- **BREAKING**: Description becomes a required field in the web UI task creation modal
- Add `mergeBranch` field to the task creation modal
- Add `--project` flag to CLI `create` command (required)
- CLI commands output task with full project details (name, displayName, workingDirectory)
- Update specs to reflect the new requirements

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `task-management`: Create task requirement changes — project and description are now mandatory
- `cli-app`: Create command requires `--project` flag
- `web-portal`: Create task modal adds project dropdown (required), description required, and merge branch field

## Impact

- **Database**: `tasks.project_id` column constraint enforced at app level
- **API**: `POST /api/tasks` validates `projectId` is present
- **CLI**: `atq create` requires `--project <id>` flag; all commands output task with project details
- **UI**: `CreateTaskModal` adds required project dropdown and merge branch input; description field becomes required
- **Breaking change**: Any external consumer creating tasks without a project will fail
