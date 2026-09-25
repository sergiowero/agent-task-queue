---
name: agentq-code
description: Coding phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `ready_for_code` or `changes_requested`, now in `coding` (the agentq-claim router sends you here). Works in the task's git worktree, implements the code or fixes review feedback, commits on the feature branch after the initial implementation and after every review round, and submits with the `submit_code` MCP tool and the worktree path. Never pushes, never commits in the main working directory.
allowed-tools: mcp__agentq__get_task_brief, mcp__agentq__submit_code, mcp__agentq__report_blocker, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*)
metadata:
  version: "6.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Code Skill

Follow this skill when you hold a task claimed from `ready_for_code` or `changes_requested` (its status is now `coding`). The cross-cutting rules in `agentq-claim` (identity, MCP conventions, context reading, context handoff, autonomy, guardrails, no tasks available) still apply. Read the task through its **brief** (`brief` in the claim result, or `get_task_brief`): the latest handoffs, open findings and `humanNotes` come first.

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
- `git push` happens only in the merging phase (`agentq-pr`), never here.

## Commit Before Submit

Every time you change code, commit it. Do NOT call `submit_code` with uncommitted changes in the worktree.

### Initial implementation (claimed from `ready_for_code`)

1. Go to the worktree (create it if needed — see Worktree Rules)
2. Read `task.description`, `task.steerDetails`, `task.guardrails`, `task.acceptanceCriteria` (each has an id like `AC1` and a `verify` method), `task.approvedPlan` (the approved plan and its **validation plan**), `task.conversation[]` and `task.contexts[]`
3. **Tests first.** Write the tests the validation plan names (`approvedPlan.validation.items[].newTests`). For a bug, first write a test that fails without the fix
4. Implement the code until those tests pass
5. Run the validation plan's commands and its `regressionCommands` (or the project's test/typecheck/lint commands when there is no plan) and keep the output: it is your evidence
6. Go through the Self-review checklist below
7. Commit it:
   ```bash
   git add -A
   git commit -m "{task.title} (#{task.id})"
   ```
8. Submit with `submit_code` (see Submit Code)

The validation plan is frozen once approved. If it cannot be followed (a command cannot work, a criterion cannot be tested as planned), do **not** change it or work around it: call `report_blocker` and say why.

### Review fixes (claimed from `changes_requested`)

When a review requests changes, the feedback is in `task.findings[]` (each finding has an id like `R1-2`, a severity, and usually a file and line) and in the review message of the conversation (`messageType: "review"`). A person's change request is a `user` message. Fix it and commit AGAIN in the same worktree:

1. Go to the existing worktree (never create a new one)
2. Read the open findings (`task.findings[]` with `status: "open"`) and the latest review message
3. Fix every `blocker` and `major` finding; fix `minor`/`nit` ones when cheap. Answer **every** open finding in `findingResolutions`: `fixed` (and how) or `wontfix` (and why). The tool refuses a submit that leaves an open finding unanswered. When the verifier sent the task back, its failing commands are in `task.evidence` and the latest `verify` message
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
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "message": "<markdown message>",
  "worktree": "<absolute worktree path>", "branch": "<task.recommendedBranch>", "headSha": "<git rev-parse HEAD>",
  "evidence": [
    { "kind": "command", "criterionId": "AC1", "command": "bun test theme", "exitCode": 0, "summary": "4 pass, 0 fail" },
    { "kind": "manual", "criterionId": "AC2", "summary": "Checked the header at 375px: toggle visible" }
  ],
  "criteria": [{ "id": "AC1", "status": "met" }, { "id": "AC2", "status": "met" }],
  "findingResolutions": [{ "id": "R1-1", "status": "fixed", "resolution": "Added the empty-list test in src/a.test.ts" }],
  "context": "<handoff notes>" }
```

- `evidence.summary` holds the relevant output lines, not the whole log.
- `criteria` is your view; the verifier and the reviewer check it.
- `findingResolutions` is required for every open finding (none on the first round).

`context` is required too (see Context Handoff in `agentq-claim`). For the reviewer, include: what to look at first, known limitations or shortcuts, and how you verified it (tests run, what was not tested). After a review round, list the finding ids you fixed and any you deliberately did not, and why.

It stores the worktree path and the evidence and releases the task. When the project has commands, the AgentQ verifier runs them next in your worktree (`verify_requested`): red sends the task back to you with the output, and deleted, skipped or weakened tests count as a failure. Then the review: an AI reviewer under autonomy L1 and higher, a person under L0. On `{ "success": false, "error": "..." }`, read the error: `Task must be in Coding status.` or `claimed by another agent session` means the task is no longer yours (stop); anything else, fix the arguments and call it again.

## Code Template

The `message` MUST be Markdown.

```markdown
## Changes

### Commits
- `abc1234` - [summary of commit]

### Files Modified
- `path/to/file` - [what changed]

### Evidence
| Criterion | How | Result |
|-----------|-----|--------|
| AC1 | `bun test theme` | pass |

### Findings
- R1-1 fixed — [how] (review rounds only)

### Notes
- [any notes]
```

## Self-review checklist

Before `submit_code`:

- [ ] I read my whole diff (`git diff {task.mergeBranch}...HEAD`)
- [ ] Every acceptance criterion has a status and evidence
- [ ] Every open finding has a resolution (fixed, or wontfix with a reason)
- [ ] I ran the validation plan's regression commands and summarised their output
- [ ] I did not delete, skip (`.skip`, `.only`, `xit`) or weaken tests, nor lower coverage thresholds
- [ ] No debug logs, stray TODOs or files outside the task's scope

## Guardrails

- **DO NOT** change the approved validation plan or weaken tests to make them pass - call `report_blocker` instead
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
