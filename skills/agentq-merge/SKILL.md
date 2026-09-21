---
name: agentq-merge
description: Merging phase of the AgentQ workflow. Use right after `agentq claim` returned a task with status `approved` (the agentq-workflow router sends you here). Verifies the task worktree is clean, pushes the feature branch from the main repo, opens a pull request into `task.mergeBranch` with `gh pr create`, keeps the lease alive with `agentq heartbeat`, and records the PR with `agentq submit-merge`. Never merges locally, never force-pushes; on push or PR failure it stops and reports.
allowed-tools: Bash(agentq:*), Bash(git:*), Bash(gh:*)
metadata:
  version: "2.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Merge Skill

Follow this skill when `agentq claim` returned a task with status `approved` (the review passed; the claim moved it to `merging`). The cross-cutting rules in `agentq-workflow` (identity, CLI conventions, context reading, autonomy, guardrails, no tasks available) still apply.

## Phase

| Task Status | Phase | Action |
|-------------|-------|--------|
| `approved` | Merging | Verify nothing is left uncommitted, push the feature branch, create a PR into `mergeBranch` with `gh pr create`, then `submit-merge` |

The code was already committed to the feature branch during the coding phase. Your job: verify nothing is left uncommitted, push the feature branch, create a **pull request** from the feature branch into the merge branch using the GitHub CLI (`gh`), and record the PR. Do NOT merge the branches locally — the PR is the integration mechanism.

Two branches matter:
- **Feature branch** = `task.recommendedBranch` — where the worktree lives. The changes were committed here during coding.
- **Merge target / PR base** = `task.mergeBranch` (default `develop`) — where the finished code must land (via the PR).

## Working Directory

| Phase | Directory | Why |
|-------|-----------|-----|
| Merging | Worktree to verify clean, then main repo (`task.project.workingDirectory`) for the push and PR creation | The feature branch is committed during coding; the push and `gh pr create` run from the main repo |

- Always `cd` into the appropriate directory before each step — never assume which one to use.
- **Worktree**: use `task.worktreePath` when set; otherwise `{project}/.agentq/worktrees/{task.id}` (`{project}` is `task.project.workingDirectory`). Never `/tmp`. Do NOT create a new worktree if one is already assigned.
- **Merge location**: push the feature branch and run `gh pr create` from the **main repo** (`task.project.workingDirectory`), NOT from the worktree — the feature branch is checked out in the worktree.

## Git Safety

| Phase | Git operations allowed |
|-------|------------------------|
| Merging | Verify the worktree has no uncommitted changes (commit any stragglers), push the feature branch, then create a PR into `mergeBranch` with `gh pr create`. The ONLY phase where `git push` is allowed. |

- `agentq submit-merge` is queue bookkeeping — it does NOT run git and does NOT create the PR. The feature branch is committed during coding; you push it and create the PR with `gh pr create` before calling it.
- NEVER force-push (`git push --force` / `-f`).
- NEVER commit in the main working directory (`task.project.workingDirectory`) — commits live in the task worktree.

## Heartbeat

A claim holds a lease (default 15 min; see `task.leaseExpiresAt` in the claim response). Extend the lease roughly every 5–10 minutes while working through the steps below (pushes and PR creation can be slow); calling it more often is harmless:

```bash
agentq heartbeat <taskId> --agent-id <agent.id> --json
```

`<agent.id>` is the `agent.id` value from the claim response.

## Step by Step

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
- **If the push fails**, do NOT create the PR. Report the error details (the full command output) to the user so they can add them to the task conversation, and **stop — let the user take control**. Do NOT force-push, do NOT call `submit-merge`.

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
- **If `gh pr create` fails** (e.g. not authenticated, `gh` not installed, head branch not pushed): report the error details to the user and **stop — let the user take control**. Do NOT call `submit-merge` for a PR that was never created.

### Step 5 — Record the PR

```bash
agentq submit-merge {task.id} --json \
  -b {task.mergeBranch} \
  -c <feature-branch-head-sha> \
  --authors "<implementer>,<co-authors>" \
  --worktree {task.worktreePath} \
  --context "<summary>" \
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

- **Push failure (Step 3)** or **PR creation failure (Step 4)**: do NOT proceed to `submit-merge`. Report the error details to the user and **stop — let the user take control**. Never force-push, never call `submit-merge` for a merge/PR that never happened.

## Submit Merge

`agentq submit-merge` only **records** a completed merge (a created PR) in the queue. It does **NOT** run git and does **NOT** create the PR — the feature branch is committed during coding, then you push it and create the PR with the GitHub CLI (`gh`) BEFORE calling it.

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

## Merge Template

All `-m` messages MUST be in Markdown format.

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

## Guardrails

- **DO NOT** create the PR until all changes are committed AND pushed - the head branch MUST be on `origin` first
- **DO NOT** merge the feature branch into `mergeBranch` locally - use the GitHub CLI (`gh pr create`) to open a PR instead
- **DO NOT** call `submit-merge` before the PR was successfully created - it records, it does not merge or create PRs
- **DO NOT** pass the feature branch as `-b` or a merge commit as `-c` - `-b` must be `mergeBranch` (the PR base) and `-c` the feature-branch head SHA
- **DO** use the `gh` CLI (`gh pr create`) to create the pull request - never use raw GitHub API calls
- **DO NOT** force-push (`git push --force` / `-f`)
- **DO NOT** amend or rewrite commits made in earlier phases - each round of changes is a new commit
- **DO NOT** commit in the main working directory - commits live in the task worktree
- **DO NOT** stash, commit, or discard uncommitted changes in the main repo that you did not create - stop and report
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- If the push or PR creation fails: report the error details to the user and STOP - let the user take control
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit
