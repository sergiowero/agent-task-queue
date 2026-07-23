# AgentQ Create Task Skill

Instructions for AI agents to create well-structured tasks via the AgentQ CLI.

## ADDED Requirements

### Requirement: Project discovery before creation
The skill SHALL teach agents to discover available projects before creating a task.

#### Scenario: Agent discovers projects via CLI
- **WHEN** agent needs to create a task
- **THEN** agent runs `agentq projects --json` to discover registered projects

#### Scenario: Agent infers project from context
- **WHEN** user provides a project name in the prompt
- **THEN** agent matches it against project displayNames from `agentq projects --json`
- **WHEN** no project name is given
- **THEN** agent infers the project by matching cwd to project.workingDirectory
- **WHEN** project is ambiguous
- **THEN** agent asks the user to specify which project

### Requirement: Task elaboration
The skill SHALL teach agents to elaborate user requests into detailed, actionable tasks. Description and acceptance criteria MUST always be enhanced by the agent.

#### Scenario: Agent elaborates description
- **WHEN** agent receives a user request
- **THEN** agent expands the description to include: what needs to be done, why it's needed, technical approach suggestions, and implementation notes
- **THEN** agent generates 3-5 specific, testable acceptance criteria

#### Scenario: Agent respects user overrides
- **WHEN** user specifies a priority or branch name
- **THEN** agent uses those exact values instead of generating them
- **WHEN** user does not specify priority or branch
- **THEN** agent auto-generates a kebab-case branch name from the task title and assigns default priority 0

### Requirement: Task creation via CLI
The skill SHALL instruct agents to create tasks using the `agentq create` command.

#### Scenario: Agent creates task with elaborated fields
- **WHEN** agent has identified the project and elaborated the task
- **THEN** agent runs `agentq create "<title>" --project <id> --description "<elaborated>" --branch <branch> --priority <n> --json`
- **THEN** agent parses the JSON response and confirms the task was created
