---
name: agentq-code
description: Coding phase of the AgentQ workflow. Use right after `agentq claim` returned a task with status `ready_for_code` or `changes_requested` (the agentq-claim router sends you here). Works in the task's git worktree, implements the code or fixes review feedback, commits on the feature branch after the initial implementation and after every review round, and submits with `agentq submit-code --worktree`. Never pushes, never commits in the main working directory.
allowed-tools: Bash(agentq:*), Bash(git:*)
metadata:
  version: "2.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Code Skill

Follow this skill when `agentq claim` returned a task with status `ready_for_code` or `changes_requested`. The cross-cutting rules in `agentq-claim` (identity, CLI conventions, context reading, autonomy, guardrails, no tasks available) still apply.

## Phase

| Task Status | Phase | Action |
|-------------|-------|--------|
| `ready_for_code` | Coding | Implement the code, then commit it in the worktree |
| `changes_requested` | Coding | Fix issues from review, then commit again in the worktree |

## Working Directory

| Phase | Directory | Why |
|-------|-----------|-----|
| Coding / Changes Requested | Worktree (`{project}/.agentq/worktrees/{task.id}`) | Isolate code changes from other tasks |

Always `cd` into the worktree before starting work — never assume which one to use. `{project}` is `task.project.workingDirectory`.

## Worktree Rules

- **Check first**: If `task.worktreePath` is set, use that path instead of creating new. If the directory already exists, it was left from a previous session — reuse it.
- **Path format**: Always `{project}/.agentq/worktrees/{task.id}` — never `/tmp`
- **Creation command** (run from `task.project.workingDirectory`, the main repo):
  ```bash
  git worktree add {project}/.agentq/worktrees/{task.id} {task.recommendedBranch}
  ```
  If `{task.recommendedBranch}` does not exist yet, create it from the merge branch: `git worktree add -b {task.recommendedBranch} {project}/.agentq/worktrees/{task.id} {task.mergeBranch}`
- **Mandatory for submit-code**: The `--worktree` flag is required when submitting code
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- **Coding-phase commits**: commit the task's changes inside the worktree on the feature branch — after the initial implementation and after EVERY round of review fixes (see Commit Before Submit)

## Git Safety

| Phase | Git operations allowed |
|-------|------------------------|
| Coding / Changes Requested | `git add` + `git commit` in the worktree are REQUIRED — commit after the initial implementation and after EVERY round of review fixes. NO `git push`. |

- `agentq submit-code` is queue bookkeeping — it does NOT run git. Commit your work in the worktree BEFORE calling it.
- NEVER commit in the main working directory (`task.project.workingDirectory`) — commits live in the task worktree.
- NEVER force-push (`git push --force` / `-f`). NEVER amend or rewrite commits made in earlier rounds — each round of changes is a new commit.
- `git push` happens only in the merging phase (`agentq-merge`), never here.

## Commit Before Submit

Every time you change code, commit it. Do NOT call `submit-code` with uncommitted changes in the worktree.

### Initial implementation (`ready_for_code`)

1. Go to the worktree (create it if needed — see Worktree Rules)
2. Read `task.description`, `task.steerDetails`, `task.guardrails`, `task.acceptanceCriteria`, `task.conversation[]` (an approved plan, if any, is there) and `task.contexts[]`
3. Implement the code, verify it (run the project's tests/build where available)
4. Commit it:
   ```bash
   git add -A
   git commit -m "{task.title} (#{task.id})"
   ```
5. Submit:
   ```bash
   agentq submit-code <taskId> --json -m "<markdown message>" --worktree <worktreePath> [--context "<summary>"]
   ```

### Review fixes (`changes_requested`)

When a review requests changes, the feedback is in the task conversation (`messageType: "review"`). Fix it and commit AGAIN in the same worktree:

1. Go to the existing worktree (never create a new one)
2. Read the review feedback from `task.conversation[]`
3. Fix the issues
4. Commit again:
   ```bash
   git add -A
   git commit -m "fix: address review feedback ({task.id})"
   ```
5. Submit:
   ```bash
   agentq submit-code <taskId> --json -m "<markdown message>" --worktree <worktreePath> [--context "<summary>"]
   ```

Repeat steps 1–5 for every round of review changes. Each round adds a NEW commit — never amend or rewrite history, never force-push.

## Submit Code

Commit your changes in the worktree BEFORE calling `submit-code` — it only records the submission, it does NOT run git. `--worktree` is mandatory and must be the worktree path (`task.worktreePath` or the path you created).

```bash
agentq submit-code <taskId> --json -m "<markdown message>" --worktree <worktreePath> [--context "<summary>"]
```

## Code Template

All `-m` messages MUST be in Markdown format.

```markdown
## Changes

### Commits
- `abc1234` - [summary of commit]

### Files Modified
- `path/to/file` - [what changed]

### Testing
- [how to verify]

### Notes
- [any notes]
```

## Guardrails

- **DO NOT** review code during coding phase - only implement
- **DO NOT** modify files outside the assigned worktree
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- **DO NOT** call `submit-code` with uncommitted changes - commit in the worktree first
- **DO NOT** run `git push` outside the merging phase
- **DO NOT** commit in the main working directory - commits live in the task worktree
- **DO NOT** force-push (`git push --force` / `-f`)
- **DO NOT** amend or rewrite commits made in earlier phases - each round of changes is a new commit
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit
