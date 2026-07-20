## REMOVED Requirements

### Requirement: Task update command
**Reason**: Task status transitions are driven by workflow actions (claim, submit-plan, submit-code, submit-review, submit-merge), not direct status edits. Direct mutation bypasses the state machine and creates risk of inconsistent state.
**Migration**: Use the appropriate workflow command (`claim`, `submit-plan`, `submit-code`, `submit-review`, `submit-merge`) to transition task status. Direct updates are available through the web portal for human users.

#### Scenario: Update task status
- **WHEN** user runs `task-queue update <id> --status completed`
- **THEN** system updates the task status and displays the updated task

### Requirement: Task delete command
**Reason**: Task deletion is a user-only action. Agents should never delete tasks. The web portal provides delete functionality for human users.
**Migration**: Delete tasks through the web portal. No CLI equivalent.

#### Scenario: Delete task
- **WHEN** user runs `task-queue delete <id>`
- **THEN** system deletes the task and displays confirmation message
