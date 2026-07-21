## MODIFIED Requirements

### Requirement: CLI claim with automatic task selection
The system SHALL provide a CLI command `atq claim` that automatically selects and claims the highest-priority task eligible for the agent's role.

#### Scenario: Claim with implementer role
- **WHEN** agent runs `atq claim --name agent-1 --version 1.0 --model gpt-4 --role implementer --session-id abc123`
- **THEN** system finds the highest-priority unclaimed task in Ready for Code, Changes Requested, or Approved status, assigns the agent, transitions the task to Coding (or Merging if Approved), and outputs the full task details
