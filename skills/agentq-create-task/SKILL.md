---
name: agentq-create-task
description: Instructions for creating well-structured tasks in AgentQ through the AgentQ MCP server (`list_projects`, `create_task`). Use when the user wants to create a task, break down work, or formalize a request into an AgentQ task for other agents to claim and execute.
allowed-tools: mcp__agentq__list_projects, mcp__agentq__create_task
metadata:
  version: "4.2.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Create Task Skill

All queue work goes through the tools of the `agentq` MCP server. Your client prefixes their names (in Claude Code `create_task` is `mcp__agentq__create_task`). If the `agentq` tools are missing, tell the user to run `bun run install:mcp` from the AgentQ checkout and restart the tool.

## Identity

- **toolName**: name of the invoking tool (e.g. `opencode`, `claude`, `codex`)
- **version**: Current tool version from configuration
- **model**: Current model from configuration
- **sessionId**: Current session ID from the invoking tool (do not generate)

## MCP Tools

### List Projects

Call `list_projects` (no arguments). It returns `{ "success": true, "projects": [...] }` with each project's `id`, `displayName` and `workingDirectory`.

### Create a Task

Call `create_task`:

```json
{ "title": "<title>",
  "projectId": "<projectId>",
  "description": "<detailed description>",
  "steerDetails": "<implementation guidance>",
  "guardrails": ["<constraint1>", "<constraint2>"],
  "acceptanceCriteria": ["<criterion1>", { "text": "<criterion2>", "verify": { "kind": "command", "command": "<command that proves it>" } }],
  "branch": "<branch-name>",
  "priority": 0,
  "requiresPlan": true,
  "type": "feature | bug | refactor | docs | chore",
  "risk": "low | medium | high (optional: defaults from the type)",
  "nonGoals": ["<what the task deliberately does not do>"],
  "references": [{ "label": "<what it is>", "target": "<URL, file path or issue id>" }],
  "mergeBranch": "<only when the user names one>",
  "context": "<initial context entry, optional>" }
```

Mandatory: `title`, `projectId`, `description`. Omit `mergeBranch` to use the project's default branch (detected from `origin/HEAD`, usually `main`). The task starts in `plan_requested` when `requiresPlan` is true, otherwise in `ready_for_code`. The result is `{ "success": true, "task": { "id": "...", "status": "...", "project": {...}, ... } }`; on failure `{ "success": false, "error": "..." }`.

## Protocol

### 1. Discover the Project

Call `list_projects` to get all registered projects. Determine which project the task belongs to:

| Priority | Method | Example |
|----------|--------|---------|
| 1st | User explicitly names a project | Match `displayName` from the result |
| 2nd | User's working directory context | Match `workingDirectory` to the repo the user is in |
| 3rd | Ask the user | Present the list and let them choose |

### 2. Elaborate the Task

Take what the user described and produce a complete, well-structured task.

**Always enhance:**
- **Description**: Functional requirements only — user story, task definition, and what needs to be accomplished. Do NOT list files, implementation details, or technical approaches here — those go in steerDetails.
- **steerDetails**: Technical recommendations, implementation hints, preferred approaches, files likely involved, architecture considerations. This is where agents look for HOW to implement, not WHAT to implement.
- **guardrails**: Do's and don'ts for agents — behavioral constraints, things to avoid, security rules, project conventions. Each guardrail should be a single, clear constraint.
- **Acceptance Criteria**: Generate 3-5 specific, testable conditions that define when the task is complete. When a command can prove one (a test run), pass it as `{ "text", "verify": { "kind": "command", "command" } }`: the verifier runs it on every code submission.

**Respect user overrides (do not override what the user specified):**
- **Priority**: If the user gives a priority, use it. Otherwise default to 0.
- **Branch**: If the user gives a branch name, use it. Otherwise generate one.
- **Merge branch**: Omit it (the project's default branch is used) unless the user names one.

**Make it ready (Definition of Ready)** — agents start without asking, so the task must say:
- What and why, with **non-goals** when the scope could be misread
- How each criterion is verified: a command (`"text $ command"` or `verify.command`), a test, or a manual check
- For a **bug**: steps to reproduce, expected and actual behaviour
- **Type** and **risk**: high risk (migrations, auth, CI, public APIs) should set `requiresPlan: true`
- **References**: files, issues or docs to look at first

`create_task` returns `task.dorIssues` when something is missing; fix them with the user before handing the task over. Projects can enforce the check, and then `create_task` refuses a task that is not ready.

**Auto-generate when not specified:**
- **Branch name**: Derive from the title using kebab-case with conventional prefix:
  - `feat/` for new features
  - `fix/` for bug fixes
  - `refactor/` for refactoring
  - `docs/` for documentation
- **Requires plan**: Set to `true` for complex or multi-step tasks, `false` for simple ones.

### 3. Create the Task

Call `create_task` with the elaborated fields (see Create a Task). `description` holds the functional requirements only; steer details, guardrails and acceptance criteria go in their own fields. Confirm to the user that the task was created, with its `id` and initial status.

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

## Out of scope

- [What this task deliberately does not do]

## Acceptance Criteria

- [ ] [Criterion 1 — specific, testable; `$ command` when a command proves it]
- [ ] [Criterion 2 — specific, testable]
- [ ] [Criterion 3 — specific, testable]
```

## Guardrails

- **NEVER** use API calls (HTTP/curl/fetch) — use the AgentQ MCP tools only (`list_projects`, `create_task`)
- **DO NOT** claim or execute the task — this skill is only for creating tasks
- **DO NOT** call `claim_task` or the `submit_*` tools — those belong to the `agentq-claim` skill
- **DO** elaborate descriptions and acceptance criteria — always add value beyond what the user provided
- **DO** respect user-specified priority and branch — only generate them when not given
- **DO** verify the project exists before creating the task
