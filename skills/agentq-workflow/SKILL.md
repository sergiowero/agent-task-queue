---
name: agentq-workflow
description: Protocol for working as an AgentQ agent. Use when connected to the AgentQ MCP server (tools next_task, get_my_task, heartbeat, submit_plan, submit_code, submit_review, finalize_task, post_comment are available). Follow this protocol to correctly claim tasks, work on them, and deliver results.
metadata:
  version: "1.0.0"
  author: "agent-task-queue"
---

# AgentQ Workflow Skill

## Identity

- **toolName**: `opencode`
- **version**: Current tool version from configuration
- **model**: Current model from configuration
- **sessionId**: Current session ID from the invoking tool (do not generate)
- **role**: Specified by user at skill invocation, default: `senior`

## CLI Commands

Use only `agentq claim` and `agentq submit-*` commands. Always pass `--json` flag.

### Claim a Task

```bash
agentq claim \
  -n <toolName> \
  -v <version> \
  -m <model> \
  -r <role> \
  -s <sessionId> \
  [--host <host>] \
  --json
```

**Response (success):**
```json
{
  "success": true,
  "task": {
    "id": "...",
    "title": "...",
    "description": "...",
    "status": "...",
    "worktreePath": null | "/tmp/agentq-{taskId}",
    "project": {
      "id": "...",
      "name": "...",
      "displayName": "...",
      "workingDirectory": "/path/to/project"
    }
  },
  "agent": {
    "id": "opencode@1.0|model",
    "role": "senior"
  }
}
```

**Response (no tasks):**
```json
{
  "success": false,
  "reason": "no_tasks_available",
  "message": "No tasks available for your role."
}
```

### Submit Plan

```bash
agentq submit-plan <taskId> --json -m "<markdown message>"
```

### Submit Code

```bash
agentq submit-code <taskId> --json -m "<markdown message>" --worktree /tmp/agentq-{taskId}
```

### Submit Review

```bash
agentq submit-review <taskId> --json -m "<markdown message>"
```

### Submit Merge

```bash
agentq submit-merge <taskId> --json -b <branch> -c <commit> --authors <authors> [-m "<message>"]
```

## Protocol

1. **Claim** a task using `agentq claim --json`
2. **Read** the task status from the response
3. **Determine phase** based on status (see Phase Intelligence)
4. **Work** on the task according to the phase
5. **Submit** using the appropriate `agentq submit-*` command
6. **Repeat** until no tasks available

## Phase Intelligence

| Task Status | Phase | Action |
|-------------|-------|--------|
| `plan_requested` | Planning | Write implementation plan |
| `plan_changes_requested` | Planning | Revise plan based on feedback |
| `ready for code` | Coding | Implement the code |
| `changes_requested` | Coding | Fix issues from review |
| `approved` | Merging | Merge the code |
| `code_review_requested` | Reviewing | Review submitted code |
| `reviewing` | Reviewing | Complete code review |

## Working Directory Per Phase

| Phase | Directory | Why |
|-------|-----------|------|
| Planning / Plan Changes Requested | `task.project.workingDirectory` | No code changes — just read the codebase and write a plan |
| Coding / Changes Requested | Worktree (`{project}/.agentq/worktrees/{task.id}`) | Isolate code changes from other tasks |
| Reviewing | Worktree path (use existing) | Inspect the actual changed files |
| Merging | Worktree path (use existing) | Commit from the worktree where changes live |

Always `cd` into the appropriate directory before starting work — never assume which one to use.

## Worktree Rules

- **Create worktree** for: `coding`, `changes_requested`, `reviewing`, `merging`
- **Skip worktree** for: `planning`, `plan_changes_requested` — work directly in `task.project.workingDirectory`
- **Creation command**: `git worktree add {project}/.agentq/worktrees/{task.id} {task.recommendedBranch}`
- **Path format**: Always `{project}/.agentq/worktrees/{task.id}` — never `/tmp`
- **Check first**: If `task.worktreePath` is set, use that path instead of creating new. If the directory already exists, it was left from a previous session — reuse it.
- **Mandatory for submit-code**: The `--worktree` flag is required when submitting code

## Git Safety

- **NO** `git add`, `git commit`, or `git push` during planning, coding, or reviewing phases
- **ALLOW** commits ONLY during merging phase (via `submit-merge`)
- Commits happen during merge submission, not during code submission

## Message Format

All `-m` messages MUST be in Markdown format.

### Plan Template
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

### Code Template
```markdown
## Changes

### Files Modified
- `path/to/file` - [what changed]

### Testing
- [how to verify]

### Notes
- [any notes]
```

### Review Template
```markdown
## Review Findings

### Issues
- [issue 1]

### Suggestions
- [suggestion 1]

### Verdict
[approve/request_changes]
```

### Merge Template
```markdown
## Merge Summary

- **Branch**: [branch name]
- **Commit**: [commit hash]
- **Authors**: [authors]

### Changes
- [summary]
```

## Context Reading

Before working on a task, read:
- `task.description` - What needs to be done
- `task.acceptanceCriteria` - Requirements to meet
- `task.conversation[]` - Previous discussion
- `task.contexts[]` - Additional context

## Autonomy

Agents MUST NOT ask the user for permission or confirmation during task execution:

- **DO NOT** ask "should I start working on this task?"
- **DO NOT** ask "is this plan correct?" before submitting
- **DO NOT** ask "should I proceed?" or "do you want me to continue?"
- **DO NOT** ask for approval before implementing changes

The workflow is: claim → work → submit → repeat. The agent decides based on the task description and acceptance criteria. If the task is unclear, use reasonable judgment and submit with notes explaining assumptions. The user reviews the result via AgentQ's review flow, not during execution.

## Guardrails

- **DO NOT** use `agentq list` or `agentq get` - agents only use `claim` and `submit-*`
- **DO NOT** manage state or generate session IDs
- **DO NOT** retry indefinitely on empty queue
- **STOP** and inform user when no tasks available
- **DO NOT** write code during planning phase - only produce a plan document
- **DO NOT** review code during coding phase - only implement
- **DO NOT** implement changes during review phase - only review and give verdict
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** skip phases - follow the status-driven phase for the current task
- **DO NOT** modify files outside the assigned worktree
- **DO NOT** jump to other tasks - focus only on the claimed task until submitted
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- **DO NOT** ask for user permission or approval - work autonomously and submit

## No Tasks Available

When `agentq claim` returns `{ "success": false, "reason": "no_tasks_available" }`:
1. Stop immediately
2. Inform the user: "No tasks available for your role."
3. Do NOT retry or loop
