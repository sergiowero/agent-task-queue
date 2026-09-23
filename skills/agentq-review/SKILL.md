---
name: agentq-review
description: Reviewing phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `code_review_requested`, now in `reviewing` (the agentq-claim router sends you here). Inspects the submitted commits read-only in the task worktree, checks them against the task's acceptance criteria and guardrails, writes findings with an approve / request_changes verdict, and submits with the `submit_review` MCP tool. Never edits, commits or pushes.
allowed-tools: mcp__agentq__submit_review, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*)
metadata:
  version: "3.1.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Review Skill

Follow this skill when you hold a task claimed from `code_review_requested` (its status is now `reviewing`). The cross-cutting rules in `agentq-claim` (identity, MCP conventions, context reading, context handoff, autonomy, guardrails, no tasks available) still apply.

## Phase

| Status | Phase | Action |
|--------|-------|--------|
| `code_review_requested` (claimed from) | Reviewing | Review submitted code |
| `reviewing` (in progress) | Reviewing | Complete code review |

## Working Directory

| Phase | Directory | Why |
|-------|-----------|-----|
| Reviewing | Worktree path (use existing) | Inspect the actual changed files |

Always `cd` into the worktree before starting work — never assume which one to use.

## Worktree Rules

- **Check first**: If `task.worktreePath` is set (the coding phase stores it with `submit_code`), use that path. If the directory already exists, it was left from a previous session — reuse it.
- **Path format**: Always `{project}/.agentq/worktrees/{task.id}` — never `/tmp`. `{project}` is `task.project.workingDirectory`.
- **Creation command** (only if no worktree exists; run from `task.project.workingDirectory`): `git worktree add {project}/.agentq/worktrees/{task.id} {task.recommendedBranch}`
- **DO NOT** create a new worktree if one is already assigned - use the existing path

## Git Safety

| Phase | Git operations allowed |
|-------|------------------------|
| Reviewing | Read-only (`git diff`, `git show`, `git log`). NO `git add`, `git commit`, `git push`. |

## Steps

1. `cd` into the worktree (see Worktree Rules) and confirm `git branch --show-current` is `{task.recommendedBranch}`
2. Read `task.description`, `task.steerDetails`, `task.guardrails`, `task.acceptanceCriteria`, `task.conversation[]` and `task.contexts[]`. The code submission (`messageType: "code"`) lists the commits and files; earlier reviews (`messageType: "review"`) tell you what was already requested
3. Inspect the submitted work read-only: `git log --oneline {task.mergeBranch}..HEAD`, `git diff {task.mergeBranch}...HEAD`, `git show <sha>`, and read the changed files
4. Check every acceptance criterion and every guardrail; look for correctness bugs, missing tests, and deviations from `task.steerDetails`
5. Write the findings with the Review Template below and give a verdict:
   - `approve` — the code meets all acceptance criteria and guardrails and has no blocking issues
   - `request_changes` — list concrete, actionable issues so the coding agent can fix them in the next round
6. Submit with `context` handoff notes (see Submit Review), then stop and wait for the next claim

The verdict is a recommendation recorded in the task conversation — the user applies it from the web UI (approve or request changes). Do not try to transition the task yourself.

## Submit Review

Call the `submit_review` MCP tool:

```json
{ "taskId": "<task.id>", "message": "<markdown message>", "context": "<handoff notes>" }
```

`context` is required (see Context Handoff in `agentq-claim`). For the next agent, include the verdict and, for `request_changes`, the blocking issues the coder must fix first (file and function); for `approve`, anything the merger or the user should know.

It moves the task back to `waiting_code_review` and releases it. On `{ "success": false, "error": "..." }`, read the error: `Task must be in Reviewing status.` means the task is no longer yours (stop); anything else, fix the arguments and call it again.

## Review Template

The `message` MUST be Markdown.

```markdown
## Review Findings

### Issues
- [issue 1]

### Suggestions
- [suggestion 1]

### Verdict
[approve/request_changes]
```

## Guardrails

- **DO NOT** implement changes during review phase - only review and give verdict
- **DO NOT** modify files in the worktree or anywhere else - reviewing is read-only
- **DO NOT** run `git add`, `git commit` or `git push` during reviewing
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit
