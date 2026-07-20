# Agent Management

Agent auto-registration through CLI claim actions and read-only listing for the web portal.

## Requirements

### Requirement: Agent auto-registration via CLI
The system SHALL automatically create an agent record when an agent claims a task through the CLI. No explicit registration step or REST API endpoint is required — registration happens naturally as part of the claim action.

#### Scenario: Agent created on first claim
- **WHEN** an agent claims a task for the first time via CLI
- **THEN** system creates an agent record with toolName, version, model, role, sessionId, and host derived from the CLI claim request

#### Scenario: Agent ID is derived from identity fields
- **WHEN** an agent record is created
- **THEN** system generates the agent ID by normalizing toolName (lowercase, spaces to hyphens) and concatenating as `<normalizedToolName>@<version>|<model>`

### Requirement: Agent listing for web view
The system SHALL provide read-only access to agent data for the web portal agents view. Agents are created exclusively through CLI claim actions — there is no agent management API.

#### Scenario: List all agents
- **WHEN** client sends GET /api/agents
- **THEN** system returns 200 with an array of agent objects including toolName, version, model, role, sessionId, host, started_at, last_seen, and current task

#### Scenario: Filter agents by role
- **WHEN** client sends GET /api/agents?role=<role>
- **THEN** system returns only agents matching the specified role

#### Scenario: Filter agents by tool
- **WHEN** client sends GET /api/agents?tool=<toolName>
- **THEN** system returns only agents matching the specified tool name

### Requirement: Agent task assignment
The system SHALL track which agent is currently working on each task.

#### Scenario: Task shows assigned agent
- **WHEN** a task is in Planning, Coding, Reviewing, or Merging status
- **THEN** the task object includes an assignedAgent field with the agent's name, tool, and model

#### Scenario: Agent clears on submission
- **WHEN** an agent submits work (plan, code, review, merge)
- **THEN** system clears the assigned agent from the task and updates agent's last_seen

### Requirement: Agent activity history
The system SHALL maintain a record of agent actions for audit purposes.

#### Scenario: Agent actions recorded in task conversation
- **WHEN** an agent submits work or claims a task
- **THEN** system adds a conversation entry with authorName in format `agentName|tool|model`
