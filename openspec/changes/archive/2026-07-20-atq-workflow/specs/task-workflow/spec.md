## MODIFIED Requirements

### Requirement: Task entity includes worktreePath field
The Task entity SHALL include a `worktreePath` field of type `string | null`. This field stores the absolute path to the worktree where the task's code changes are located. The field is `null` when no worktree has been created. The field is set by the CLI when an agent calls `submit-code` with the `--worktree` flag. The field is read by agents during review and merge phases to locate existing code.

#### Scenario: New task has null worktreePath
- **WHEN** a task is created
- **THEN** `worktreePath` is `null`

#### Scenario: Worktree path set on code submission
- **WHEN** agent calls `atq submit-code <id> --worktree /tmp/atq-abc-123`
- **THEN** the task's `worktreePath` is set to `/tmp/atq-abc-123`

#### Scenario: Worktree path readable by reviewer
- **WHEN** a task has `worktreePath: "/tmp/atq-abc-123"` and a reviewer claims it
- **THEN** the claim response includes `task.worktreePath: "/tmp/atq-abc-123"`

### Requirement: Claim command returns project object
The `atq claim` command SHALL return the full project object (not just `projectId`) in the claim response when `--json` is specified. The project object SHALL include `id`, `name`, `displayName`, and `workingDirectory`. This allows agents to know the project root directory for worktree creation.

#### Scenario: Claim includes project workingDirectory
- **WHEN** agent runs `atq claim --json` and the task has a project
- **THEN** the response includes `task.project.workingDirectory` as an absolute path

#### Scenario: Claim with no project
- **WHEN** agent runs `atq claim --json` and the task has no project
- **THEN** the response includes `task.project: null`
