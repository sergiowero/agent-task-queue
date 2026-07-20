## Why

The current claim system allows any agent to claim any specific task via an HTTP endpoint, with no priority ordering or automatic selection. This creates a "first-come-first-served" race condition where agents compete for tasks rather than the system intelligently assigning work based on priority and role fit. The claim logic should be CLI-only and automatic: agents declare who they are, and the system hands them the highest-priority task they're eligible for.

## What Changes

- **BREAKING**: Remove the HTTP claim endpoint (`POST /api/tasks/:id/claim`). The web UI will no longer support claiming tasks directly.
- Add CLI `atq claim` command that accepts agent identity args (name, version, role, model, sessionId) and auto-selects the best task.
- Implement priority-based task selection: sort eligible tasks by priority (descending), then pick the highest.
- Implement role-based eligibility filtering:
  - **planner**: New, Plan Changes Requested
  - **implementer**: Ready, Changes Requested, Approved
  - **reviewer**: Code Review Requested
  - **compound roles** (senior, architect): union of their constituent roles, with priority ordering planner > implementer > reviewer.
- Single-agent exclusivity: only one agent can claim a task at a time (already enforced, but now the system controls selection).

## Capabilities

### New Capabilities

- `cli-claim`: CLI command for automatic task claiming with role-based selection and priority ordering

### Modified Capabilities

- `workflow-transitions`: Agent claim requirement changes from "agent picks a task" to "system auto-assigns highest priority eligible task"; implementer now also claims from Approved status
- `cli-app`: Add claim command, submit-plan, submit-code, submit-review, submit-merge commands
- `web-server`: Remove claim endpoint

## Impact

- **Web server**: Remove `POST /api/tasks/:id/claim` route and `getClaimTransition` helper
- **CLI**: Add `claim` command with agent identity parameters; add submit-plan, submit-code, submit-review, submit-merge commands
- **Web UI**: Remove claim button/action from task cards and drawer
- **Workflow specs**: Update claim scenarios to reflect auto-assignment
- **Shared database**: Add query for next claimable task by role with priority ordering
