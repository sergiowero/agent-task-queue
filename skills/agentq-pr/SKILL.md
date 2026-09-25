---
name: agentq-pr
description: Pull-request phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `approved`, now in `merging` (the agentq-claim router sends you here). Verifies the task worktree is clean, pushes the feature branch, opens a pull request into `task.mergeBranch` with `gh pr create` using the body AgentQ wrote (`brief.pr.body`), and records it with the `submit_pr` MCP tool. Never merges and never force-pushes; the task waits in `pr_open` until a person merges the PR. On push or PR failure it calls `report_blocker`.
allowed-tools: mcp__agentq__get_task_brief, mcp__agentq__submit_pr, mcp__agentq__report_blocker, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*), Bash(gh:*)
metadata:
  version: "5.1.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Pull Request Skill

Follow this skill when you hold a task claimed from `approved` (the review passed; the claim moved it to `merging`). This is the **integrator** role (also part of `builder` and `senior`). The cross-cutting rules in `agentq-claim` (identity, MCP conventions, context reading, handoff, autonomy, guardrails) still apply. Read the task through its **brief** (`brief` in the claim result, or `get_task_brief`).

## What this phase does

| Claimed from | Phase | Action | Next status |
|--------------|-------|--------|-------------|
| `approved` | Pull request | Push the feature branch, open a PR into `mergeBranch` with the body from `brief.pr.body`, then `submit_pr` | `pr_open` |

The code was committed to the feature branch during coding, verified and reviewed. Your job ends when the PR exists and is recorded. **You never merge it**: a person reviews the PR on GitHub and merges it; AgentQ sees the merge and completes the task on its own (under L3 with auto-merge, AgentQ merges green low-risk PRs itself — still not you).

Two branches matter:
- **Head / feature branch** = `task.realBranch` if set, else `task.recommendedBranch` — where the worktree lives.
- **Base / merge target** = `task.mergeBranch` (usually `main`).

## Working directory

- **Worktree**: `task.worktreePath` when set; otherwise `{project}/.agentq/worktrees/{task.id}` (`{project}` is `task.project.workingDirectory`). Never `/tmp`, never a new worktree when one is assigned.
- Push and run `gh pr create` from the **main repo** (`task.project.workingDirectory`): the feature branch is checked out in the worktree.

## Step by step

### 1. Verify the worktree

```bash
cd {task.worktreePath}
git status
git branch --show-current       # MUST be the feature branch
git log --oneline {task.mergeBranch}..HEAD   # at least one commit
```

- No commits on the feature branch → `report_blocker` (there is nothing to open a PR for).
- Uncommitted changes left by the coder → commit them in the worktree: `git add -A && git commit -m "{task.title} (#{task.id})"`. Never commit in the main repo or on `mergeBranch`.

### 2. Push the feature branch

```bash
cd {task.project.workingDirectory}
git status                      # dirty with changes you did NOT make → report_blocker, never stash or discard
git fetch origin
git push -u origin {feature branch}
git rev-parse {feature branch}  # the commit you pass to submit_pr
```

Push rejected → do not open the PR; call `report_blocker` with the full output. Never force-push.

### 3. Open the PR with AgentQ's body

`brief.pr.body` is the PR description AgentQ wrote from the task: summary, acceptance criteria with their evidence, verification, the AI review and its findings, and the risk. Use it as is (you may add a short "Notes" section at the end):

```bash
cd {task.project.workingDirectory}
cat > .git/agentq-pr-body.md <<'EOF'
{brief.pr.body}
EOF
gh pr create \
  --base {task.mergeBranch} \
  --head {feature branch} \
  --title "{task.title}" \
  --body-file .git/agentq-pr-body.md
rm .git/agentq-pr-body.md
```

- Keep the body file inside `.git/` so it is never committed.
- Capture the **PR URL** printed by `gh pr create`.
- A PR for this head branch already exists → reuse it (`gh pr view {feature branch} --json url,number`), do not open a duplicate.
- `gh` missing, not authenticated or failing → `report_blocker` with the output. Never call `submit_pr` for a PR that does not exist.

### 4. Record it with `submit_pr`

```json
{ "taskId": "<task.id>",
  "claimToken": "<claimToken>",
  "prUrl": "https://github.com/<org>/<repo>/pull/<n>",
  "mergeBranch": "<task.mergeBranch>",
  "headBranch": "<feature branch>",
  "commit": "<feature-branch head SHA>",
  "authors": "<implementer>,<co-authors>",
  "worktree": "<task.worktreePath>",
  "message": "<optional notes for the person who merges>",
  "context": "PR #<n> open against <mergeBranch>; <anything the person merging should check>" }
```

| Argument | What to pass | Common mistake |
|----------|--------------|----------------|
| `prUrl` | The URL `gh pr create` printed | Leaving it out: AgentQ then cannot follow the PR |
| `mergeBranch` | The PR **base** (`task.mergeBranch`) | Passing the feature branch |
| `headBranch` | The pushed feature branch | — |
| `commit` | The feature-branch head SHA you pushed | Passing a merge commit (there is none) |
| `authors` | Everyone who wrote the code (implementing agent + human co-authors) | Only the PR-phase agent |
| `context` | Required handoff: PR URL/number, branches, what to check | Blank (the tool rejects it) |

The task moves to `pr_open` and is released. `Task must be in Merging status.` means the task is no longer yours: stop. Any other error: fix the arguments and call again.

## After submitting

Stop. You do not wait for the merge, re-run checks or poll GitHub. AgentQ syncs the PR:

| On GitHub | Task |
|-----------|------|
| Merged | `complete` (and archived if the project archives automatically) |
| Closed without merging | `needs_human`: a person decides |
| Changes requested by a person | Stays in `pr_open`; the person sends it back through AgentQ |

## Failure handling

Push or PR failure: do not call `submit_pr`. Call `report_blocker` with the error output and the one thing a person must do. The task goes to `needs_human` and no runner retries it until a person answers.

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "reason": "git push -u origin feat/x failed:\n<output>", "question": "Can you grant push access to origin (or push the branch), then send the task back to approved?" }
```

## Guardrails

- **NEVER** merge the PR, merge locally, or enable auto-merge — a person (or AgentQ under L3) merges
- **NEVER** force-push, amend or rewrite commits from earlier phases
- **DO NOT** open the PR before the branch is pushed, or call `submit_pr` before the PR exists
- **DO** use `brief.pr.body` as the PR body (`--body-file`), not a body you write from scratch
- **DO** use `gh` (never raw GitHub API calls)
- **DO NOT** commit in the main working directory, or stash/discard changes you did not make there — `report_blocker`
- **DO NOT** continue after `submit_pr` or `report_blocker` succeeds; **DO NOT** ask for permission
