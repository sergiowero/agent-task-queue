---
name: agentq-plan
description: Planning phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `plan_requested` or `plan_changes_requested`, now in `planning` (the agentq-claim router sends you here). Reads the project read-only in `task.project.workingDirectory`, writes or revises the implementation plan, and submits it with the `submit_plan` MCP tool. No worktree, no code changes, no git write operations.
allowed-tools: mcp__agentq__submit_plan, mcp__agentq__report_blocker, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*)
metadata:
  version: "4.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Plan Skill

Follow this skill when you hold a task claimed from `plan_requested` or `plan_changes_requested` (its status is now `planning`). The cross-cutting rules in `agentq-claim` (identity, MCP conventions, context reading, context handoff, autonomy, guardrails, no tasks available) still apply.

## Phase

| Claimed from | Phase | Action |
|--------------|-------|--------|
| `plan_requested` | Planning | Write implementation plan |
| `plan_changes_requested` | Planning | Revise plan based on feedback |

## Working Directory

| Phase | Directory | Why |
|-------|-----------|-----|
| Planning / Plan Changes Requested | `task.project.workingDirectory` | No code changes — just read the codebase and write a plan |

- Always `cd` into `task.project.workingDirectory` before starting work — never assume which one to use.
- **Skip worktree** for `planning` / `plan_changes_requested` — work directly in `task.project.workingDirectory`. Do not create one.

## Git Safety

| Phase | Git operations allowed |
|-------|------------------------|
| Planning / Plan Changes Requested | Read-only (`git log`, `git status`, `git show`). NO `git add`, `git commit`, `git push`. |

## Steps

1. `cd {task.project.workingDirectory}`
2. Read `task.description`, `task.steerDetails`, `task.guardrails`, `task.acceptanceCriteria`, `task.conversation[]` and `task.contexts[]` (see Context Reading in `agentq-claim`)
3. Explore the codebase read-only (read files, `git log`, `git status`, `git show`) so the plan is grounded in the real code
4. Write the plan with the Plan Template below — concrete steps, files to create/modify, and the decisions taken
5. Submit it with `context` handoff notes for the coder (see Submit Plan), then stop and wait for the next claim

### Revising a plan (`plan_changes_requested`)

The feedback is in the task conversation (`task.conversation[]`). Read it, revise the previous plan so every point is addressed, and submit the revised plan as a whole (not just the delta). Note in the plan what changed and why.

## Submit Plan

Call the `submit_plan` MCP tool:

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "message": "<markdown plan>", "context": "<handoff notes>" }
```

`context` is required (see Context Handoff in `agentq-claim`). For the coder, include: the key decisions and trade-offs, the files to start from, and open questions or risks.

It moves the task to `waiting_plan_review` and releases it. On `{ "success": false, "error": "..." }`, read the error: `Task must be in Planning status.` or `claimed by another agent session` means the task is no longer yours (stop); anything else, fix the arguments and call it again.

## Plan Template

The `message` MUST be Markdown.

```markdown
## Plan

### Steps
1. [step 1]
2. [step 2]

### Files to Create/Modify
- `path/to/file` - [description]

### Decisions
- [decision 1]
```

## Guardrails

- **DO** call `report_blocker` (see Blocked in `agentq-claim`) when something outside your control blocks this phase - never submit partial or placeholder work to move the task forward
- **DO NOT** write code during planning phase - only produce a plan document
- **DO NOT** modify files in the project - planning is read-only
- **DO NOT** create or use a worktree - planning works in `task.project.workingDirectory`
- **DO NOT** run `git add`, `git commit` or `git push` during planning
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit
