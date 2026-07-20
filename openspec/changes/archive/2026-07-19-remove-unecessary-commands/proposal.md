## Why

The `atq update` and `atq delete` commands expose raw task mutation operations to agents that should not be performing them. Task status transitions are driven by workflow actions (claim, submit-plan, submit-code, etc.), not direct status edits. Task deletion is a user-only action that belongs in the web portal, not in the agent CLI. Removing these commands simplifies the agent-facing surface area and prevents accidental or incorrect state manipulation.

## What Changes

- **Remove** the `atq update <id>` command from the CLI
- **Remove** the `atq delete <id>` command from the CLI
- **Remove** corresponding requirement and scenarios from the `cli-app` spec

## Capabilities

### New Capabilities
*(none)*

### Modified Capabilities
- `cli-app`: Remove the "Task update command" and "Task delete command" requirements and their scenarios

## Impact

- `packages/cli/src/index.ts` — remove `update` and `delete` command definitions
- `openspec/specs/cli-app/spec.md` — remove `update` and `delete` requirement sections
