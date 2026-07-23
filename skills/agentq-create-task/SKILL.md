---
name: agentq-create-task
description: Instructions for creating well-structured tasks in AgentQ via the CLI. Use when the user wants to create a task, break down work, or formalize a request into an AgentQ task for other agents to claim and execute.
metadata:
  version: "1.0.0"
  author: "agent-task-queue"
---

# AgentQ Create Task Skill

## Identity

- **toolName**: `opencode`
- **version**: Current tool version from configuration
- **model**: Current model from configuration
- **sessionId**: Current session ID from the invoking tool (do not generate)

## CLI Commands

### List Projects

```bash
agentq projects --json
```

Returns all registered projects with `id`, `displayName`, and `workingDirectory`.

### Create a Task

```bash
agentq create "<title>" \
  --project <projectId> \
  --description "<detailed description>" \
  --branch <branch-name> \
  --priority <0-5> \
  --requires-plan <true|false> \
  --merge-branch <branch> \
  [--context "<initial context entry>"] \
  --json
```

Mandatory: `--project`, `--description`. The `title` is a positional argument.

## Protocol

### 1. Discover the Project

Run `agentq projects --json` to get all registered projects. Determine which project the task belongs to:

| Priority | Method | Example |
|----------|--------|---------|
| 1st | User explicitly names a project | Match `displayName` from the output |
| 2nd | User's working directory context | Match `workingDirectory` to the repo the user is in |
| 3rd | Ask the user | Present the list and let them choose |

### 2. Elaborate the Task

Take what the user described and produce a complete, well-structured task.

**Always enhance:**
- **Description**: Expand the user's input into a detailed specification. Include what needs to be done, why it's needed, technical context and any relevant details. Make it actionable for the agent who will claim it. Do not add file references or technical implementation details unless the user provided them, implementation details will be covered on planning and execution.
- **Acceptance Criteria**: Generate 3-5 specific, testable conditions that define when the task is complete.

**Respect user overrides (do not override what the user specified):**
- **Priority**: If the user gives a priority, use it. Otherwise default to 0.
- **Branch**: If the user gives a branch name, use it. Otherwise generate one.
- **Merge branch**: Default to `develop` unless the user specifies otherwise.

**Auto-generate when not specified:**
- **Branch name**: Derive from the title using kebab-case with conventional prefix:
  - `feat/` for new features
  - `fix/` for bug fixes
  - `refactor/` for refactoring
  - `docs/` for documentation
- **Requires plan**: Set to `true` for complex or multi-step tasks, `false` for simple ones.

### 3. Create the Task

```bash
agentq create "<Elaborated Title>" \
  --project <projectId> \
  --description "<elaborated markdown description with acceptance criteria>" \
  --branch <branch-name> \
  --priority <priority> \
  --requires-plan <true|false> \
  --json
```

Parse the JSON response and confirm to the user that the task was created with its ID.

## Task Elaboration Template

When writing the description, use this structure:

```markdown
## Description

[What needs to be done — expanded from user's request]

## Motivation

[Why this is needed — business or technical context]

## Technical Notes

[Implementation approach, files likely involved, architecture considerations]

## Acceptance Criteria

- [ ] [Criterion 1 — specific, testable]
- [ ] [Criterion 2 — specific, testable]
- [ ] [Criterion 3 — specific, testable]
```

## Guardrails

- **NEVER** use API calls (HTTP/curl/fetch) — use CLI only (`agentq create`, `agentq projects`)
- **DO NOT** claim or execute the task — this skill is only for creating tasks
- **DO NOT** use `agentq claim` or `agentq submit-*` — those belong to the `agentq-workflow` skill
- **DO** elaborate descriptions and acceptance criteria — always add value beyond what the user provided
- **DO** respect user-specified priority and branch — only generate them when not given
- **DO** verify the project exists before creating the task
