## ADDED Requirements

### Requirement: Shared workflow functions
The `@agentq/shared` package SHALL export pure functions for `recordHistory`, `addConversation`, `addActivity`, `getClaimTransition`, `getEffectiveRole`, and `getClaimableStatuses`.

#### Scenario: recordHistory returns updated task
- **WHEN** calling `recordHistory(task, newStatus)`
- **THEN** it returns a new task object with updated status and appended history entry, without mutating the input

#### Scenario: addConversation returns updated task
- **WHEN** calling `addConversation(task, author, message, type)`
- **THEN** it returns a new task with the conversation entry appended

### Requirement: Web server uses shared functions
The web server (`packages/web/src/index.ts`) SHALL import workflow functions from `@agentq/shared` instead of defining its own copies.

#### Scenario: Web server transitions use shared
- **WHEN** any workflow action (submit-plan, approve, cancel, etc.) is called
- **THEN** the handler calls `recordHistory` and `addConversation` from `@agentq/shared`

### Requirement: CLI uses shared functions
The CLI (`packages/cli/src/index.ts`) SHALL import workflow functions from `@agentq/shared` instead of defining its own copies.

#### Scenario: CLI transitions use shared
- **WHEN** any CLI submit command is called
- **THEN** the handler calls `recordHistory` and `addConversation` from `@agentq/shared`
