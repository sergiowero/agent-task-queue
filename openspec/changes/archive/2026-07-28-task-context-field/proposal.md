## Why

The `contexts` field exists in the task data model and database, but is never exposed in the CLI or web UI. Agents working on tasks have no way to communicate their current context (what they're working on, what they've found, what's blocking them) to the next agent who picks up the task. This creates information loss on every handoff — a reviewer has no idea what the implementer was thinking, and the next planner can't see what happened before.

## What Changes

- **`agentq claim`** gets a new optional `--context` flag so agents can record their initial context when claiming a task
- **`agentq submit-plan`**, **`agentq submit-code`**, **`agentq submit-review`**, **`agentq submit-merge`** get a new optional `--context` flag so agents append context entries on every submission
- **`agentq create`** gets a new optional `--context` flag for initial context
- **Task detail page** gets a new "Context" tab showing all context entries with timestamps and author names
- **CLI text output** (`agentq get`, `agentq list --json`, `agentq create`, etc.) includes context entries when available
- **`agentq-workflow` skill** updated so agents know to include `--context` on submissions

## Capabilities

### New Capabilities
- `task-context`: Context entries for task lifecycle — claiming, submissions, and display

### Modified Capabilities
- `cli-app`: CLI commands gain `--context` flags; output displays context entries
- `task-detail-page`: Task detail page adds a "Context" tab
- `atq-skill`: Workflow skill includes context submission in agent protocol

## Impact

- `packages/shared/src/types.ts` — Task type already has `contexts: string[]`
- `packages/cli/src/index.ts` — Add `--context` to claim, submit-plan, submit-code, submit-review, submit-merge commands
- `packages/web-ui/` — New Context tab component on task detail page
- `skills/agentq-workflow/SKILL.md` — Update protocol to include context on submissions
