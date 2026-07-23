# Task Context

Context entries provide handoff summaries between agents working on the same task across lifecycle stages.

## ADDED Requirements

### Requirement: Context entries are string array on task
The system SHALL store context entries as `contexts: string[]` on the Task object. Each entry is a short free-text summary. Entries are append-only — new entries are pushed to the end of the array.

#### Scenario: Context array initialized empty
- **WHEN** a task is created without `--context`
- **THEN** the `contexts` field is an empty array

#### Scenario: Context array accepts string entries
- **WHEN** context entries are added to a task
- **THEN** each entry is appended as a plain string to the `contexts` array

### Requirement: Context entries are displayed in CLI output
The `agentq get <id>` text output SHALL display context entries as a numbered list when the array is non-empty. JSON output (`--json`) SHALL include the `contexts` array.

#### Scenario: Get task with context entries shows them
- **WHEN** user runs `agentq get <id>` on a task that has context entries
- **THEN** the text output shows each context entry as `Context #N: <entry>` in order

#### Scenario: Get task with empty context shows nothing
- **WHEN** user runs `agentq get <id>` on a task with no context entries
- **THEN** the context section is omitted from text output

#### Scenario: JSON output includes contexts
- **WHEN** user runs `agentq get <id> --json` on a task with context entries
- **THEN** the JSON includes the `contexts` array with all entries
