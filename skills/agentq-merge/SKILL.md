---
name: agentq-merge
description: Merging phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `approved`, now in `merging` (the agentq-claim router sends you here). Verifies the task worktree is clean, pushes the feature branch from the main repo, opens a pull request into `task.mergeBranch` with `gh pr create`, and records the PR with the `submit_merge` MCP tool. Never merges locally, never force-pushes; on push or PR failure it calls `report_blocker` so a person takes over.
allowed-tools: mcp__agentq__submit_merge, mcp__agentq__report_blocker, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*), Bash(gh:*)
metadata:
  version: "4.1.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Merge Skill

Follow this skill when you hold a task claimed from `approved` (the review passed; the claim moved it to `merging`). The cross-cutting rules in `agentq-claim` (identity, MCP conventions, context reading, context handoff, autonomy, guardrails, no tasks available) still apply.

## Phase

| Claimed from | Phase | Action |
|--------------|-------|--------|
| `approved` | Merging | Verify nothing is left uncommitted, push the feature branch, create a PR into `mergeBranch` with `gh pr create`, then `submit_merge` |

The code was already committed to the feature branch during the coding phase. Your job: verify nothing is left uncommitted, push the feature branch, create a **pull request** from the feature branch into the merge branch using the GitHub CLI (`gh`), and record the PR. Do NOT merge the branches locally — the PR is the integration mechanism.

Two branches matter:
- **Feature branch** = `task.recommendedBranch` — where the worktree lives. The changes were committed here during coding.
- **Merge target / PR base** = `task.mergeBranch` (the project's default branch unless the task names another, usually `main`) — where the finished code must land (via the PR).

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

- `submit_merge` is queue bookkeeping — it does NOT run git and does NOT create the PR. The feature branch is committed during coding; you push it and create the PR with `gh pr create` before calling it.
- NEVER force-push (`git push --force` / `-f`).
- NEVER commit in the main working directory (`task.project.workingDirectory`) — commits live in the task worktree.

## Step by Step

### Step 1 — Go to the worktree and verify state

```bash
cd {task.worktreePath}          # always use the stored path when set
git status
git branch --show-current       # MUST be {task.recommendedBranch}
```

- If `worktreePath` is not set, use `{project}/.agentq/worktrees/{task.id}`.
- The coding phase already committed the changes. If the worktree has NO commits on the feature branch, call `report_blocker` — there is nothing to create a PR for.

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

- Before touching anything: `git status` in the main repo. If it has uncommitted changes you did not create, call `report_blocker` — never stash, commit, or discard the user's work.
- **If the push fails**, do NOT create the PR. Call `report_blocker` with the full command output as `reason` and what a person must do (e.g. grant push access, resolve a conflict) as `question`. Do NOT force-push, do NOT call `submit_merge`.

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
- Capture the **PR URL / number** from the output — you need it for `submit_merge`.
- If a PR for this exact head branch already exists, reuse it — capture its URL and skip creating a duplicate.
- **If `gh pr create` fails** (e.g. not authenticated, `gh` not installed, head branch not pushed): call `report_blocker` with the error output. Do NOT call `submit_merge` for a PR that was never created.

### Step 5 — Record the PR

Call the `submit_merge` MCP tool:

```json
{ "taskId": "<task.id>",
  "claimToken": "<claimToken from claim_task or the runner prompt>",
  "mergeBranch": "<task.mergeBranch>",
  "commit": "<feature-branch-head-sha>",
  "authors": "<implementer>,<co-authors>",
  "worktree": "<task.worktreePath>",
  "context": "<handoff notes: PR URL, base/head, anything left for the user>",
  "message": "## PR Created\n- **PR**: <PR URL or number>\n- **Base / Merge branch**: <task.mergeBranch>\n- **Head / Feature branch**: <task.recommendedBranch>\n- **Commit**: <feature-branch-head-sha>\n- **Authors**: <implementer>,<co-authors>\n\n### Changes\n- <what the PR delivers>" }
```

- `mergeBranch` = `task.mergeBranch` (the PR base), `commit` = the feature-branch head SHA (from `git rev-parse HEAD` on the feature branch, Step 3/4), `authors` = the implementing agent (from the task conversation) plus any human co-authors.

It moves the task to `merged` and releases it. On `{ "success": false, "error": "..." }`, read the error: `Task must be in Merging status.` means the task is no longer yours (stop); anything else, fix the arguments and call it again.

### Failure handling

- **Push failure (Step 3)** or **PR creation failure (Step 4)**: do NOT proceed to `submit_merge`. Call `report_blocker` with the error output and the one thing a person must do. The task goes to `needs_human` and no runner retries it until a person answers. Never force-push, never call `submit_merge` for a merge/PR that never happened.

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "reason": "git push -u origin feat/x failed:\n<output>", "question": "Can you grant push access to origin (or push the branch), then send the task back to approved?" }
```

## Submit Merge

`submit_merge` only **records** a completed merge (a created PR) in the queue. It does **NOT** run git and does **NOT** create the PR — the feature branch is committed during coding, then you push it and create the PR with the GitHub CLI (`gh`) BEFORE calling it.

| Argument | What to pass | Common mistake |
|----------|--------------|----------------|
| `mergeBranch` | The **PR base / merge target branch** (`task.mergeBranch`, e.g. `main`) | Passing the feature branch instead |
| `commit` | The **feature-branch head commit SHA** pushed to `origin` (from `git rev-parse HEAD` on the feature branch) | Passing a merge commit SHA — there is no local merge commit anymore |
| `authors` | Comma-separated names of everyone who wrote the code (implementing agent + human co-authors) | Passing only the merge-phase agent |
| `worktree` | Path where the code was implemented (`task.worktreePath`) | Omitting it |
| `context` | Required handoff notes: the PR URL/number, base and head branches, and anything left for the user after the merge | Omitting it (the tool rejects the submit) |
| `message` | The Merge Template below, with the PR URL/number from `gh pr create` — it becomes part of the task conversation | Leaving the PR out |

## Merge Template

The `message` MUST be Markdown.

```markdown
## PR Created

- **PR**: [PR URL or number]
- **Base / Merge branch**: [mergeBranch, e.g. main]
- **Head / Feature branch**: [feature branch]
- **Commit**: [feature-branch head SHA from git rev-parse HEAD]
- **Authors**: [implementing agent + co-authors]

### Changes
- [summary]
```

## Guardrails

- **DO NOT** create the PR until all changes are committed AND pushed - the head branch MUST be on `origin` first
- **DO NOT** merge the feature branch into `mergeBranch` locally - use the GitHub CLI (`gh pr create`) to open a PR instead
- **DO NOT** call `submit_merge` before the PR was successfully created - it records, it does not merge or create PRs
- **DO NOT** pass the feature branch as `mergeBranch` or a merge commit as `commit` - `mergeBranch` must be the PR base and `commit` the feature-branch head SHA
- **DO** use the `gh` CLI (`gh pr create`) to create the pull request - never use raw GitHub API calls
- **DO NOT** force-push (`git push --force` / `-f`)
- **DO NOT** amend or rewrite commits made in earlier phases - each round of changes is a new commit
- **DO NOT** commit in the main working directory - commits live in the task worktree
- **DO NOT** stash, commit, or discard uncommitted changes in the main repo that you did not create - call `report_blocker`
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- If the push or PR creation fails: call `report_blocker` with the error output - never "stop and tell the user" (a runner has no user watching)
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit
