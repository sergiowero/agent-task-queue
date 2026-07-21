---
name: atq-workflow
description: Protocol for working as an ATQ agent. Use when connected to the ATQ MCP server (tools next_task, get_my_task, heartbeat, submit_plan, submit_code, submit_review, finalize_task, post_comment are available). Follow this protocol to correctly claim tasks, work on them, and deliver results.
metadata:
  version: "1.0.0"
  author: "agent-task-queue"
---

# ATQ Workflow Skill

## Identity

- **toolName**: `opencode`
- **version**: Current tool version from configuration
- **model**: Current model from configuration
- **sessionId**: Current session ID from the invoking tool (do not generate)
- **role**: Specified by user at skill invocation, default: `senior`

## CLI Commands

Use only `atq claim` and `atq submit-*` commands. Always pass `--json` flag.

### Claim a Task

```bash
atq claim \
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
    "worktreePath": null | "/tmp/atq-{taskId}",
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
atq submit-plan <taskId> --json -m "<markdown message>"
```

### Submit Code

```bash
atq submit-code <taskId> --json -m "<markdown message>" --worktree /tmp/atq-{taskId}
```

### Submit Review

```bash
atq submit-review <taskId> --json -m "<markdown message>"
```

### Submit Merge

```bash
atq submit-merge <taskId> --json -b <branch> -c <commit> --authors <authors> [-m "<message>"]
```

## Protocol

1. **Claim** a task using `atq claim --json`
2. **Read** the task status from the response
3. **Determine phase** based on status (see Phase Intelligence)
4. **Work** on the task according to the phase
5. **Submit** using the appropriate `atq submit-*` command
6. **Repeat** until no tasks available

## Phase Intelligence

| Task Status | Phase | Action |
|-------------|-------|--------|
| `new` | Planning | Write implementation plan |
| `plan_changes_requested` | Planning | Revise plan based on feedback |
| `ready for code` | Coding | Implement the code |
| `changes_requested` | Coding | Fix issues from review |
| `approved` | Merging | Merge the code |
| `code_review_requested` | Reviewing | Review submitted code |
| `reviewing` | Reviewing | Complete code review |

## Worktree Rules

- **Create worktree** for: `coding`, `changes_requested`, `reviewing`, `merging`
- **Skip worktree** for: `planning`, `plan_changes_requested`
- **Creation command**: `git worktree add /tmp/atq-{task.id} {task.recommendedBranch}`
- **Use existing**: If `task.worktreePath` is set, use that path instead of creating new

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

## Guardrails

- **DO NOT** use `atq list` or `atq get` - agents only use `claim` and `submit-*`
- **DO NOT** manage state or generate session IDs
- **DO NOT** retry indefinitely on empty queue
- **STOP** and inform user when no tasks available

## No Tasks Available

When `atq claim` returns `{ "success": false, "reason": "no_tasks_available" }`:
1. Stop immediately
2. Inform the user: "No tasks available for your role."
3. Do NOT retry or loop
