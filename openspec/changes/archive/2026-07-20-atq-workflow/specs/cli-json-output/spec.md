## ADDED Requirements

### Requirement: CLI commands support --json flag
All CLI commands (`claim`, `submit-plan`, `submit-code`, `submit-review`, `submit-merge`) SHALL accept a `--json` flag that switches output to JSON format. When `--json` is specified, the command outputs a single JSON object to stdout. When `--json` is omitted, the command outputs human-readable text (existing behavior).

#### Scenario: Claim with --json flag
- **WHEN** agent runs `atq claim -n opencode -v 1.0 -m kimi2.5 -r senior -s uuid --json`
- **THEN** the command outputs a JSON object with `success`, `task`, and `agent` fields

#### Scenario: Claim without --json flag
- **WHEN** agent runs `atq claim -n opencode -v 1.0 -m kimi2.5 -r senior -s uuid`
- **THEN** the command outputs human-readable text (existing behavior)

### Requirement: Claim command returns full task with project object
When `--json` is specified, `atq claim` SHALL return a JSON object containing the full task with an embedded `project` object (not just `projectId`). The `project` object SHALL include `id`, `name`, `displayName`, and `workingDirectory`. If the task has no project, `project` SHALL be `null`.

#### Scenario: Claim returns project details
- **WHEN** agent runs `atq claim --json` and a task with a project is assigned
- **THEN** the response includes `task.project.workingDirectory` with the absolute path to the project root

#### Scenario: Claim returns null project
- **WHEN** agent runs `atq claim --json` and the assigned task has no project
- **THEN** the response includes `task.project: null`

### Requirement: Claim command returns agent identity
When `--json` is specified, `atq claim` SHALL return an `agent` object containing the agent's canonical `id` (formed as `{normalizedToolName}@{version}|{model}`) and the effective `role` used for the claim.

#### Scenario: Claim returns agent identity
- **WHEN** agent runs `atq claim --json` with toolName "opencode", version "1.0", model "kimi2.5"
- **THEN** the response includes `agent.id: "opencode@1.0|kimi2.5"` and `agent.role: "senior"`

### Requirement: Claim returns failure as JSON
When no tasks are available for the agent's role, `atq claim --json` SHALL return `{ "success": false, "reason": "no_tasks_available", "message": "..." }`.

#### Scenario: Empty queue with --json
- **WHEN** agent runs `atq claim --json` and no tasks match the role
- **THEN** the response is `{ "success": false, "reason": "no_tasks_available" }`

### Requirement: Submit commands return structured confirmation
When `--json` is specified, all `atq submit-*` commands SHALL return a JSON object with `success`, `taskId`, `previousStatus`, `newStatus`, and `message` fields.

#### Scenario: Submit-plan returns confirmation
- **WHEN** agent runs `atq submit-plan abc-123 --json -m "plan details"`
- **THEN** the response includes `success: true`, `taskId: "abc-123"`, `previousStatus: "planning"`, `newStatus: "waiting_plan_review"`

#### Scenario: Submit-code returns confirmation
- **WHEN** agent runs `atq submit-code abc-123 --json -m "changes" --worktree /tmp/atq-abc-123`
- **THEN** the response includes `success: true`, `newStatus: "waiting_code_review"`, and the task's `worktreePath` is set to `/tmp/atq-abc-123`

### Requirement: Submit-code stores worktree path on task
When `atq submit-code` is called with `--worktree <path>`, the CLI SHALL store the worktree path in the task's `worktreePath` field. This path SHALL be visible to subsequent agents who claim the task for review or merge.

#### Scenario: Worktree path persists for reviewer
- **WHEN** coder submits code with `--worktree /tmp/atq-abc-123`
- **THEN** when reviewer claims the task, `task.worktreePath` is `/tmp/atq-abc-123`

### Requirement: Submit commands return error as JSON
When a submit command fails (wrong status, task not found), the CLI SHALL return `{ "success": false, "error": "..." }` when `--json` is specified.

#### Scenario: Submit-code on wrong status
- **WHEN** agent runs `atq submit-code abc-123 --json` but task status is "planning"
- **THEN** the response is `{ "success": false, "error": "Task must be in Coding status." }`
