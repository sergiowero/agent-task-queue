---
name: agentq-plan
description: Planning phase of the AgentQ workflow. Use right after `agentq claim` returned a task with status `plan_requested` or `plan_changes_requested` (the agentq-workflow router sends you here). Reads the project read-only in `task.project.workingDirectory`, writes or revises the implementation plan, and submits it with `agentq submit-plan`. No worktree, no code changes, no git write operations.
allowed-tools: Bash(agentq:*), Bash(git:*)
metadata:
  version: "2.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Plan Skill

Follow this skill when `agentq claim` returned a task with status `plan_requested` or `plan_changes_requested`. The cross-cutting rules in `agentq-workflow` (identity, CLI conventions, context reading, autonomy, guardrails, no tasks available) still apply.

## Phase

| Task Status | Phase | Action |
|-------------|-------|--------|
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

## Heartbeat

A claim holds a lease (default 15 min; see `task.leaseExpiresAt` in the claim response). Exploring a large codebase can take longer, so extend the lease roughly every 5–10 minutes while you work — calling it more often is harmless:

```bash
agentq heartbeat <taskId> --agent-id <agent.id> --json
```

`<agent.id>` is the `agent.id` value from the claim response.

## Steps

1. `cd {task.project.workingDirectory}`
2. Read `task.description`, `task.steerDetails`, `task.guardrails`, `task.acceptanceCriteria`, `task.conversation[]` and `task.contexts[]` (see Context Reading in `agentq-workflow`)
3. Explore the codebase read-only (read files, `git log`, `git status`, `git show`) so the plan is grounded in the real code
4. Write the plan with the Plan Template below — concrete steps, files to create/modify, and the decisions taken
5. Submit it (see Submit Plan), then stop and wait for the next claim

### Revising a plan (`plan_changes_requested`)

The feedback is in the task conversation (`task.conversation[]`). Read it, revise the previous plan so every point is addressed, and submit the revised plan as a whole (not just the delta). Note in the plan what changed and why.

## Submit Plan

```bash
agentq submit-plan <taskId> --json -m "<markdown message>" [--context "<summary>"]
```

## Plan Template

All `-m` messages MUST be in Markdown format.

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

- **DO NOT** write code during planning phase - only produce a plan document
- **DO NOT** modify files in the project - planning is read-only
- **DO NOT** create or use a worktree - planning works in `task.project.workingDirectory`
- **DO NOT** run `git add`, `git commit` or `git push` during planning
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit
