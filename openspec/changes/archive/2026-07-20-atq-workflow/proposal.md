## Why

Coding agents (OpenCode, Claude, Codex, etc.) need a structured way to interact with the Agent Task Queue. Without a skill, agents don't know how to claim tasks, what phase they're in, or how to submit work. The CLI exists but agents have no protocol to follow. This change creates the `atq-workflow` skill that teaches agents the exact workflow: claim → read status → work → submit.

## What Changes

- New AI skill file (`atq-workflow`) that defines the agent protocol for interacting with ATQ CLI
- CLI output format changes: all commands return JSON for agent consumption
- New `worktreePath` field on Task to track where code lives across agents
- CLI stores worktree path on submit-code so reviewers and mergers know where to find the work
- Claim command returns full task JSON including project details (workingDirectory)

## Capabilities

### New Capabilities

- `agent-skill`: The skill definition that teaches coding agents how to interact with ATQ — identity, protocol, phase intelligence, worktree rules, git safety, and submission format
- `cli-json-output`: JSON output mode for all CLI commands so agents can parse structured responses instead of human-readable text

### Modified Capabilities

- `task-workflow`: Task entity gains a `worktreePath` field; claim command includes project object in response; submit-code stores worktree path on task

## Impact

- `.opencode/skills/atq-workflow/SKILL.md` — new skill file
- `packages/cli/src/index.ts` — JSON output, worktreePath handling, project inclusion in claim
- `packages/shared/src/types.ts` — Task type gains worktreePath field
- `packages/shared/src/database.ts` — schema update for worktreePath column
- `project.md` — documentation update for new field and agent workflow
