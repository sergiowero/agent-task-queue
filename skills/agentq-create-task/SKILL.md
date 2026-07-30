---
name: agentq-create-task
description: Instructions for creating well-structured tasks in AgentQ via the CLI. Use when the user wants to create a task, break down work, or formalize a request into an AgentQ task for other agents to claim and execute.
allowed-tools: Bash(agentq:*)
metadata:
  version: "1.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>
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
  --steer-details "<implementation guidance>" \
  --guardrails "<constraint1|constraint2|constraint3>" \
  --acceptance-criteria "<criterion1|criterion2|criterion3>" \
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
- **Description**: Functional requirements only — user story, task definition, and what needs to be accomplished. Do NOT list files, implementation details, or technical approaches here — those go in steerDetails.
- **steerDetails**: Technical recommendations, implementation hints, preferred approaches, files likely involved, architecture considerations. This is where agents look for HOW to implement, not WHAT to implement.
- **guardrails**: Do's and don'ts for agents — behavioral constraints, things to avoid, security rules, project conventions. Each guardrail should be a single, clear constraint.
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
  --description "<functional requirements only — steerDetails go separately>" \
  --steer-details "<technical recommendations, implementation hints>" \
  --guardrails "<constraint1|constraint2>" \
  --acceptance-criteria "<criterion1|criterion2>" \
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

[Functional requirements only — what needs to be done, expanded from user's request. Do NOT include files, implementation details, or technical approaches.]

## Motivation

[Why this is needed — business or technical context]

## Steer Details

[Technical recommendations, implementation hints, preferred approaches, files likely involved, architecture considerations. Do NOT include behavioral constraints — those go in guardrails.]

## Guardrails

- [Behavioral constraint 1 — e.g., "DO NOT use external APIs"]
- [Behavioral constraint 2 — e.g., "MUST support backward compatibility"]

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
