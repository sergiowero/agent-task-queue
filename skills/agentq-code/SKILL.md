---
name: agentq-code
description: Coding phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `ready_for_code` or `changes_requested`, now in `coding` (the agentq-claim router sends you here). Works in the task's git worktree, implements the code or fixes review feedback, commits on the feature branch after the initial implementation and after every review round, and submits with the `submit_code` MCP tool and the worktree path. Never pushes, never commits in the main working directory.
allowed-tools: mcp__agentq__submit_code, mcp__agentq__report_blocker, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*)
metadata:
  version: "4.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Code Skill

Follow this skill when you hold a task claimed from `ready_for_code` or `changes_requested` (its status is now `coding`). The cross-cutting rules in `agentq-claim` (identity, MCP conventions, context reading, context handoff, autonomy, guardrails, no tasks available) still apply.

## Phase

| Claimed from | Phase | Action |
|--------------|-------|--------|
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
- **Mandatory for submit_code**: the `worktree` argument is required when submitting code
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- **Coding-phase commits**: commit the task's changes inside the worktree on the feature branch — after the initial implementation and after EVERY round of review fixes (see Commit Before Submit)

## Git Safety

| Phase | Git operations allowed |
|-------|------------------------|
| Coding / Changes Requested | `git add` + `git commit` in the worktree are REQUIRED — commit after the initial implementation and after EVERY round of review fixes. NO `git push`. |

- `submit_code` is queue bookkeeping — it does NOT run git. Commit your work in the worktree BEFORE calling it.
- NEVER commit in the main working directory (`task.project.workingDirectory`) — commits live in the task worktree.
- NEVER force-push (`git push --force` / `-f`). NEVER amend or rewrite commits made in earlier rounds — each round of changes is a new commit.
- `git push` happens only in the merging phase (`agentq-merge`), never here.

## Commit Before Submit

Every time you change code, commit it. Do NOT call `submit_code` with uncommitted changes in the worktree.

### Initial implementation (claimed from `ready_for_code`)

1. Go to the worktree (create it if needed — see Worktree Rules)
2. Read `task.description`, `task.steerDetails`, `task.guardrails`, `task.acceptanceCriteria`, `task.conversation[]` (an approved plan, if any, is there) and `task.contexts[]`
3. Implement the code, verify it (run the project's tests/build where available)
4. Commit it:
   ```bash
   git add -A
   git commit -m "{task.title} (#{task.id})"
   ```
5. Submit with `submit_code` (see Submit Code)

### Review fixes (claimed from `changes_requested`)

When a review requests changes, the feedback is in `task.findings[]` (each finding has an id like `R1-2`, a severity, and usually a file and line) and in the review message of the conversation (`messageType: "review"`). A person's change request is a `user` message. Fix it and commit AGAIN in the same worktree:

1. Go to the existing worktree (never create a new one)
2. Read the open findings (`task.findings[]` with `status: "open"`) and the latest review message
3. Fix every `blocker` and `major` finding; fix `minor`/`nit` ones when cheap. In your `submit_code` message, answer each open finding by id: fixed (and how) or not fixed (and why)
4. Commit again:
   ```bash
   git add -A
   git commit -m "fix: address review feedback ({task.id})"
   ```
5. Submit with `submit_code` (see Submit Code)

Repeat steps 1–5 for every round of review changes. Each round adds a NEW commit — never amend or rewrite history, never force-push.

## Submit Code

Commit your changes in the worktree BEFORE calling `submit_code` — it only records the submission, it does NOT run git. `worktree` is mandatory and must be the absolute worktree path (`task.worktreePath` or the path you created). Call the `submit_code` MCP tool:

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "message": "<markdown message>", "worktree": "<absolute worktree path>", "context": "<handoff notes>" }
```

`context` is required too (see Context Handoff in `agentq-claim`). For the reviewer, include: what to look at first, known limitations or shortcuts, and how you verified it (tests run, what was not tested). After a review round, list the finding ids you fixed and any you deliberately did not, and why.

It stores the worktree path, releases the task and sends it to review: to an AI reviewer (`code_review_requested`) under autonomy L1 and higher, to a person (`waiting_code_review`) under L0. On `{ "success": false, "error": "..." }`, read the error: `Task must be in Coding status.` or `claimed by another agent session` means the task is no longer yours (stop); anything else, fix the arguments and call it again.

## Code Template

The `message` MUST be Markdown.

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

- **DO** call `report_blocker` (see Blocked in `agentq-claim`) when something outside your control blocks this phase - never submit partial or placeholder work to move the task forward
- **DO NOT** review code during coding phase - only implement
- **DO NOT** modify files outside the assigned worktree
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- **DO NOT** call `submit_code` with uncommitted changes - commit in the worktree first
- **DO NOT** call `submit_code` without `context` handoff notes for the reviewer
- **DO NOT** run `git push` outside the merging phase
- **DO NOT** commit in the main working directory - commits live in the task worktree
- **DO NOT** force-push (`git push --force` / `-f`)
- **DO NOT** amend or rewrite commits made in earlier phases - each round of changes is a new commit
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit
