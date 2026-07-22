## Why

Agents can currently submit code without creating a worktree, potentially modifying the main branch directly. The worktree path is not displayed in the UI, and the skill doesn't enforce creation before coding. This risks code contamination and makes it impossible to track where work actually happened.

## What Changes

- **BREAKING**: `submit-code` requires `--worktree` flag (currently optional)
- Worktree path displayed in task details UI
- Skill enforces worktree creation before coding phase
- Worktree path moved to `.atq/worktrees/{taskId}` inside the project
- Skill guardrails prevent agents from jumping between tasks
- Skill removes any mention of `atq list` — only `claim` and `submit-*` allowed

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `task-workflow`: Worktree becomes mandatory for coding; path standardized to `.atq/worktrees/{taskId}`; UI displays worktree info
- `atq-skill`: Guardrails added for single-task focus and worktree enforcement; `atq list` references removed

## Impact

- **CLI**: `submit-code` command — `--worktree` becomes required
- **Web UI**: `TaskDrawer.tsx` — display worktree path field
- **Web Backend**: No API changes needed (field already exists)
- **Skill**: Guardrails and worktree rules updated
