---
name: agentq-review
description: Reviewing phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `code_review_requested`, now in `reviewing` (the agentq-claim router sends you here). Verifies the previous round's findings by id, inspects the submitted commits read-only in the task worktree against the acceptance criteria and guardrails, and submits a verdict (approve / request_changes / needs_human) with structured findings through the `submit_review` MCP tool. The verdict routes the task. Never edits, commits or pushes.
allowed-tools: mcp__agentq__get_task_brief, mcp__agentq__submit_review, mcp__agentq__report_blocker, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*)
metadata:
  version: "4.2.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Review Skill

Follow this skill when you hold a task claimed from `code_review_requested` (its status is now `reviewing`). The cross-cutting rules in `agentq-claim` (identity, MCP conventions, context reading, context handoff, autonomy, guardrails, no tasks available) still apply. Read the task through its **brief** (`brief` in the claim result, or `get_task_brief`): the latest handoffs, open findings and `humanNotes` come first.

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
2. Read `task.description`, `task.steerDetails`, `task.guardrails`, `task.acceptanceCriteria` (with their status), `task.approvedPlan` (the plan and its validation plan), `task.verification` and `task.evidence` (what the coder and the verifier ran), `task.conversation[]`, `task.contexts[]` and `task.findings[]` (earlier findings, with ids like `R1-2`). The code submission (`messageType: "code"`) lists the commits and files
3. **Verify the previous round first.** For every finding of an earlier round that is not `verified`, check the new commits: pass it in `verifiedFindings` as `verified` (fixed) or `open` (still not fixed). Do not re-raise it as a new finding
4. Inspect the submitted work read-only: `git log --oneline {task.mergeBranch}..HEAD`, `git diff {task.mergeBranch}...HEAD`, `git show <sha>`, and read the changed files. Run the project's tests or the commands the coder says they ran when you can (read-only: do not fix anything)
5. Check every acceptance criterion against the approved validation plan: the planned tests exist and test what the criterion says. Do not trust the evidence blindly: re-run at least the commands tied to the criteria. Check every guardrail; look for correctness bugs, missing or weakened tests, deviations from the plan and from `task.steerDetails`
6. Record each new problem as a finding with a severity (see Severity Rubric) and pick the verdict (see Verdict Rules)
7. Submit with `context` handoff notes (see Submit Review), then stop and wait for the next claim

## Severity Rubric

| Severity | Use it for | Blocks approve |
|----------|-----------|----------------|
| `blocker` | Wrong behaviour, data loss, security issue, an acceptance criterion not met, a guardrail violated, tests deleted or skipped | Yes |
| `major` | Missing tests for new behaviour, an unhandled edge case the task implies, a regression risk | Yes |
| `minor` | Maintainability, naming that misleads, small gaps that do not break the task | No |
| `nit` | Style and taste | No |

- At most about 10 findings: the most important ones. Nothing the linter or formatter already reports.
- Each finding says what is wrong and what to do instead, with `file` and `line` when it points at code.

## Verdict Rules

The verdict **routes the task** (under the project's autonomy level):

- `approve` — no open `blocker` or `major` findings (the server refuses approve otherwise). The task moves on toward the PR; a person still sees it when the task is high risk or picked for a spot check.
- `request_changes` — at least one open finding the coder must fix. The task goes back to the coder with your findings by id. After the project's round limit (3 by default) a person decides instead.
- `needs_human` — you cannot decide (conflicting requirements, a product decision, a risk only a person can accept). Pass `question`: what the person must decide.

Under autonomy L0 (supervised) the verdict is advice: the task goes to a person, who approves or requests changes from the portal.

## Submit Review

Call the `submit_review` MCP tool:

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>",
  "verdict": "approve | request_changes | needs_human",
  "verifiedFindings": [{ "id": "R1-1", "status": "verified" }, { "id": "R1-2", "status": "open" }],
  "findings": [{ "severity": "major", "file": "src/cache.ts", "line": 42, "text": "Invalidation misses the per-user key; add a test with two users." }],
  "question": "<only with needs_human>",
  "message": "<markdown summary, see Review Template>", "context": "<handoff notes>" }
```

New findings get ids `R<round>-<n>`; the coder answers them by id in the next round.

`context` is required (see Context Handoff in `agentq-claim`). For the next agent, include the verdict and, for `request_changes`, the finding ids to fix first and why; for `approve`, anything the merger or the user should know.

On `{ "success": false, "error": "..." }`, read the error: `Task must be in Reviewing status.` or `claimed by another agent session` means the task is no longer yours (stop); `Cannot approve with open blocker or major findings` means verify those findings or request changes; anything else, fix the arguments and call it again.

## Review Template

The `message` MUST be Markdown. It summarises; the findings themselves go in `findings[]`.

```markdown
## Review — round <n>

**Verdict:** approve | request_changes | needs_human

### Previous findings
- R1-1 verified — <how>
- R1-2 still open — <why>

### This round
- <one line per new finding, by severity>

### Checked
- Acceptance criteria: <which ones and how>
- Commands run: <e.g. bun test (pass)>
```

## Guardrails

- **DO** call `report_blocker` (see Blocked in `agentq-claim`) when something outside your control blocks this phase - never submit partial or placeholder work to move the task forward
- **DO NOT** implement changes during review phase - only review and give verdict
- **DO NOT** approve with open `blocker` or `major` findings, and **DO NOT** request changes without a finding the coder can act on
- **DO NOT** modify files in the worktree or anywhere else - reviewing is read-only
- **DO NOT** run `git add`, `git commit` or `git push` during reviewing
- **DO NOT** create a new worktree if one is already assigned - use the existing path
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit
