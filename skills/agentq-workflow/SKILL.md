---
name: agentq-workflow
description: Protocol for working as an AgentQ agent. Use when connected to the AgentQ MCP server (tools next_task, get_my_task, heartbeat, submit_plan, submit_code, submit_review, finalize_task, post_comment are available). Follow this protocol to correctly claim tasks, work on them, and deliver results.
allowed-tools: Bash(agentq:*)
metadata:
  version: "1.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
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

Include `--context "<short summary of current state, findings, or blockers>"` on every `agentq claim` and `agentq submit-*` so the next agent has context.

### Claim a Task

```bash
agentq claim \
  -n <toolName> \
  -v <version> \
  -m <model> \
  -r <role> \
  -s <sessionId> \
  [--host <host>] \
  [--context "<summary>"] \
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
    "steerDetails": "...",
    "guardrails": ["..."],
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
agentq submit-plan <taskId> --json -m "<markdown message>" [--context "<summary>"]
```

### Submit Code

Commit your changes in the worktree BEFORE calling `submit-code` — it only records the submission, it does NOT run git. See [Coding Phase — Commit Before Submit](#coding-phase--commit-before-submit).

```bash
agentq submit-code <taskId> --json -m "<markdown message>" --worktree /tmp/agentq-{taskId} [--context "<summary>"]
```

### Submit Review

```bash
agentq submit-review <taskId> --json -m "<markdown message>" [--context "<summary>"]
```

### Submit Merge

`agentq submit-merge` only **records** a completed merge (a created PR) in the queue. It does **NOT** run git and does **NOT** create the PR — the feature branch is committed during coding, then you push it and create the PR with the GitHub CLI (`gh`) BEFORE calling it. See [Merge Phase — Step by Step](#merge-phase--step-by-step).

```bash
agentq submit-merge <taskId> --json -b <mergeBranch> -c <feature-branch-head-sha> --authors "<name1>,<name2>" [-m "<message>"] [--worktree <path>] [--context "<summary>"]
```

| Flag | What to pass | Common mistake |
|------|--------------|----------------|
| `-b` | The **PR base / merge target branch** (`task.mergeBranch`, e.g. `develop`) | Passing the feature branch instead |
| `-c` | The **feature-branch head commit SHA** pushed to `origin` (from `git rev-parse HEAD` on the feature branch) | Passing a merge commit SHA — there is no local merge commit anymore |
| `--authors` | Comma-separated names of everyone who wrote the code (implementing agent + human co-authors) | Passing only the merge-phase agent |
| `--worktree` | Path where the code was implemented (`task.worktreePath`) | Omitting it |

Include the PR URL/number from `gh pr create` in `-m` — it becomes part of the task conversation.

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
| `ready for code` | Coding | Implement the code, then commit it in the worktree |
| `changes_requested` | Coding | Fix issues from review, then commit again in the worktree |
| `approved` | Merging | Verify nothing is left uncommitted, push the feature branch, create a PR into `mergeBranch` with `gh pr create`, then `submit-merge` |
| `code_review_requested` | Reviewing | Review submitted code |
| `reviewing` | Reviewing | Complete code review |

## Working Directory Per Phase

| Phase | Directory | Why |
|-------|-----------|------|
| Planning / Plan Changes Requested | `task.project.workingDirectory` | No code changes — just read the codebase and write a plan |
| Coding / Changes Requested | Worktree (`{project}/.agentq/worktrees/{task.id}`) | Isolate code changes from other tasks |
| Reviewing | Worktree path (use existing) | Inspect the actual changed files |
| Merging | Worktree to verify clean, then main repo (`task.project.workingDirectory`) for the push and PR creation | The feature branch is committed during coding; the push and `gh pr create` run from the main repo |

Always `cd` into the appropriate directory before starting work — never assume which one to use.

## Worktree Rules

- **Create worktree** for: `coding`, `changes_requested`, `reviewing`, `merging`
- **Skip worktree** for: `planning`, `plan_changes_requested` — work directly in `task.project.workingDirectory`
- **Creation command**: `git worktree add {project}/.agentq/worktrees/{task.id} {task.recommendedBranch}`
- **Path format**: Always `{project}/.agentq/worktrees/{task.id}` — never `/tmp`
- **Check first**: If `task.worktreePath` is set, use that path instead of creating new. If the directory already exists, it was left from a previous session — reuse it.
- **Mandatory for submit-code**: The `--worktree` flag is required when submitting code
- **Coding-phase commits**: commit the task's changes inside the worktree on the feature branch — after the initial implementation and after EVERY round of review fixes (see [Coding Phase — Commit Before Submit](#coding-phase--commit-before-submit))
- **Merge location**: push the feature branch and run `gh pr create` from the **main repo** (`task.project.workingDirectory`), NOT from the worktree — the feature branch is checked out in the worktree

## Git Safety

| Phase | Git operations allowed |
|-------|------------------------|
| Planning / Plan Changes Requested | Read-only (`git log`, `git status`, `git show`). NO `git add`, `git commit`, `git push`. |
| Coding / Changes Requested | `git add` + `git commit` in the worktree are REQUIRED — commit after the initial implementation and after EVERY round of review fixes. NO `git push`. |
| Reviewing | Read-only (`git diff`, `git show`, `git log`). NO `git add`, `git commit`, `git push`. |
| Merging | Verify the worktree has no uncommitted changes (commit any stragglers), push the feature branch, then create a PR into `mergeBranch` with `gh pr create`. The ONLY phase where `git push` is allowed. See [Merge Phase — Step by Step](#merge-phase--step-by-step). |

- `agentq submit-code` is queue bookkeeping — it does NOT run git. Commit your work in the worktree BEFORE calling it. See [Coding Phase — Commit Before Submit](#coding-phase--commit-before-submit).
- `agentq submit-merge` is queue bookkeeping — it does NOT run git and does NOT create the PR. The feature branch is committed during coding; you push it and create the PR with `gh pr create` before calling it.
- NEVER force-push (`git push --force` / `-f`).
- NEVER commit in the main working directory (`task.project.workingDirectory`) — commits live in the task worktree.

## Coding Phase — Commit Before Submit

Every time you change code, commit it. Do NOT call `submit-code` with uncommitted changes in the worktree.

### Initial implementation (`ready for code`)

1. Go to the worktree (create it if needed — see [Worktree Rules](#worktree-rules))
2. Implement the code
3. Commit it:
   ```bash
   git add -A
   git commit -m "{task.title} (#{task.id})"
   ```
4. Submit:
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
   agentq submit-code <taskId> --json -m "<markdown message>" --worktree <worktreePath>
   ```

Repeat steps 1–5 for every round of review changes. Each round adds a NEW commit — never amend or rewrite history, never force-push.

## Merge Phase — Step by Step

You reach this phase when `agentq claim` returns a task with status `approved` (the review passed). The code was already committed to the feature branch during the coding phase. Your job: verify nothing is left uncommitted, push the feature branch, create a **pull request** from the feature branch into the merge branch using the GitHub CLI (`gh`), and record the PR. Do NOT merge the branches locally — the PR is the integration mechanism.

Two branches matter:
- **Feature branch** = `task.recommendedBranch` — where the worktree lives. Your changes were committed here during coding.
- **Merge target / PR base** = `task.mergeBranch` (default `develop`) — where the finished code must land (via the PR).

### Step 1 — Go to the worktree and verify state

```bash
cd {task.worktreePath}          # always use the stored path when set
git status
git branch --show-current       # MUST be {task.recommendedBranch}
```

- If `worktreePath` is not set, use `{project}/.agentq/worktrees/{task.id}`.
- The coding phase already committed the changes. If the worktree has NO commits on the feature branch, **stop and report** — there is nothing to create a PR for.

### Step 2 — Commit anything left uncommitted

The merge phase does NOT create the task commits (that already happened during coding). It only makes sure nothing is missing:

```bash
git add -A
git commit -m "{task.title} (#{task.id})"   # run ONLY if `git status` shows uncommitted changes
```

- If `git status` is clean, skip this step — there is nothing to commit.
- Commit **inside the worktree**, on the feature branch. Never in the main working directory, never on `mergeBranch`.

### Step 3 — Push the feature branch

Everything must be on the remote before the PR can be created. Run this from the **main repository** (`task.project.workingDirectory`), not from the worktree:

```bash
cd {task.project.workingDirectory}
git status                      # if dirty with changes you did NOT create, STOP and report
git fetch origin
git push -u origin {task.recommendedBranch}
```

- Before touching anything: `git status` in the main repo. If it has uncommitted changes you did not create, **stop and report** — never stash, commit, or discard the user's work.
- **If the push fails**, do NOT create the PR. Add a message to the task conversation with the error details (e.g. use the MCP `post_comment` tool) and **stop — let the user take control**. Do NOT force-push, do NOT call `submit-merge`.

### Step 4 — Create the PR into mergeBranch with `gh`

```bash
cd {task.project.workingDirectory}
gh pr create \
  --base {task.mergeBranch} \
  --head {task.recommendedBranch} \
  --title "{task.title} (#{task.id})" \
  --body "## Summary
<short description of what the feature does>

Closes task #{task.id}"
```

- `--base` = the PR base / merge target (`task.mergeBranch`); `--head` = the pushed feature branch.
- Capture the **PR URL / number** from the output — you need it for `submit-merge`.
- If a PR for this exact head branch already exists, reuse it — capture its URL and skip creating a duplicate.
- **If `gh pr create` fails** (e.g. not authenticated, `gh` not installed, head branch not pushed): add a message to the task conversation with the error details and **stop — let the user take control**. Do NOT call `submit-merge` for a PR that was never created.

### Step 5 — Record the PR

```bash
agentq submit-merge {task.id} --json \
  -b {task.mergeBranch} \
  -c <feature-branch-head-sha> \
  --authors "<implementer>,<co-authors>" \
  --worktree {task.worktreePath} \
  -m "## PR Created
- **PR**: <PR URL or number>
- **Base / Merge branch**: {task.mergeBranch}
- **Head / Feature branch**: {task.recommendedBranch}
- **Commit**: <feature-branch-head-sha>
- **Authors**: <implementer>,<co-authors>

### Changes
- <what the PR delivers>"
```

- `-b` = `task.mergeBranch` (the PR base), `-c` = the feature-branch head SHA (from `git rev-parse HEAD` on the feature branch, Step 3/4), `--authors` = the implementing agent (from the task conversation) plus any human co-authors.

### Failure handling

- **Push failure (Step 3)** or **PR creation failure (Step 4)**: do NOT proceed to `submit-merge`. Post the error details to the task conversation and **stop — let the user take control**. Never force-push, never call `submit-merge` for a merge/PR that never happened.

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

### Commits
- `abc1234` - [summary of commit]

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
## PR Created

- **PR**: [PR URL or number]
- **Base / Merge branch**: [mergeBranch, e.g. develop]
- **Head / Feature branch**: [feature branch]
- **Commit**: [feature-branch head SHA from git rev-parse HEAD]
- **Authors**: [implementing agent + co-authors]

### Changes
- [summary]
```

## Context Reading

Before working on a task, read:
- `task.description` - Functional requirements only — what needs to be accomplished
- `task.steerDetails` - Technical recommendations, implementation hints, preferred approaches
- `task.guardrails` - Behavioral constraints, do's and don'ts for agents
- `task.acceptanceCriteria` - Specific, testable conditions that define completion
- `task.conversation[]` - Previous discussion
- `task.contexts[]` - Additional context

Agents MUST respect guardrails — they define hard constraints that must not be violated during implementation. If a guardrail conflicts with other requirements, the guardrail takes precedence.

## Autonomy

Agents MUST NOT ask the user for permission or confirmation during task execution:

- **DO NOT** ask "should I start working on this task?"
- **DO NOT** ask "is this plan correct?" before submitting
- **DO NOT** ask "should I proceed?" or "do you want me to continue?"
- **DO NOT** ask for approval before implementing changes

The workflow is: claim → work → submit → repeat. The agent decides based on the task description and acceptance criteria. If the task is unclear, use reasonable judgment and submit with notes explaining assumptions. The user reviews the result via AgentQ's review flow, not during execution.

## Guardrails

- **NEVER** use API calls (HTTP/curl/fetch) — use CLI only (`agentq claim`, `agentq submit-*`)
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
- **DO NOT** run `git commit` during planning or reviewing phases - only coding and merging phases commit
- **DO NOT** run `git push` outside the merging phase
- **DO NOT** commit in the main working directory - commits live in the task worktree
- **DO NOT** call `submit-code` with uncommitted changes - commit in the worktree first
- **DO NOT** create the PR until all changes are committed AND pushed - the head branch MUST be on `origin` first
- **DO NOT** merge the feature branch into `mergeBranch` locally - use the GitHub CLI (`gh pr create`) to open a PR instead
- **DO NOT** call `submit-merge` before the PR was successfully created - it records, it does not merge or create PRs
- **DO NOT** pass the feature branch as `-b` or a merge commit as `-c` - `-b` must be `mergeBranch` (the PR base) and `-c` the feature-branch head SHA
- **DO** use the `gh` CLI (`gh pr create`) to create the pull request - never use raw GitHub API calls
- **DO NOT** force-push (`git push --force` / `-f`)
- **DO NOT** amend or rewrite commits made in earlier phases - each round of changes is a new commit
- **DO NOT** stash, commit, or discard uncommitted changes in the main repo that you did not create - stop and report
- If the push or PR creation fails: add a message to the task conversation with the error details and STOP - let the user take control
- **DO NOT** ask for user permission or approval - work autonomously and submit

## No Tasks Available

When `agentq claim` returns `{ "success": false, "reason": "no_tasks_available" }`:
1. Stop immediately
2. Inform the user: "No tasks available for your role."
3. Do NOT retry or loop
