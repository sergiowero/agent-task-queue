# Autonomy and routing

AgentQ decides where a task goes after each submission from a small policy:
the project's **autonomy level**, the task's **risk**, the **round** it is in,
and the reviewer's **verdict**. People decide intent and accept risk; agents
produce evidence and review each other. A task moves on by itself while the
evidence is green and stops with a concrete question when it is not.

The routing is in `packages/shared/src/policy.ts` (pure functions, tested as a
table in `policy.test.ts`); the settings live on the project.

## Levels

Set per project (**Projects → Edit**, `autonomy`), overridable per task. New
and existing projects start at **L2**.

| Level | Plan | Code | PR | For |
|---|---|---|---|---|
| **L0 Supervised** | Person | Person (AI review on request) | Person | High risk, new repos, a trust period |
| **L1 Human plan** | Person | AI reviewer | Person | Medium features |
| **L2 Human PR** (default) | AI critic, then a person unless low risk | AI reviewer | Person | Most tasks |
| **L3 Autonomous** | AI critic, then a person unless low risk | AI reviewer | Person, or auto-merge when green and low risk | Docs, tests, chores |

## Plan routing (L2–L3)

`submit_plan` goes to `plan_review_requested`: an agent with the `plan_review` role (never the
planner's own session) critiques it with a verdict and findings (`P<round>-<n>`).
Approve sends a **low-risk** plan straight to coding and anything riskier to a
person; request changes goes back to the planner (at most `maxPlanRounds`, then a
person); needs_human asks a person. A **blocking open question** in the plan
sends the task to a person before any critique. The planner's `suggestedRisk` and
`touchedPaths` can only raise the risk (protected paths make it high).

## Subtasks and drafts

A planner can split a task with `create_subtask` (with `blockedBy` for order). The
subtasks are held until the parent's plan is approved; then they run like any
task (a blocked one waits for its dependencies to be complete) and the parent,
in `split`, completes when they are all finished. Re-planning drops the held
subtasks of the previous plan.

A task created as a **draft** waits for an agent with the `refine` role to make it ready
(criteria, type, risk, scope) or for a person to promote it.

L0 reproduces the original behaviour exactly: the reviewer's verdict is advice
and a person approves or requests changes.

## Code review routing (L1–L3)

`submit_code` sends the task to `code_review_requested` without a click. The
reviewer's `submit_review` verdict routes it:

| Verdict | Goes to |
|---|---|
| `approve` | `approved` (the PR phase) — or `waiting_code_review` when the task is **high risk** or the approval is **sampled** for a human spot check |
| `request_changes` | `changes_requested`, with the findings by id — or `needs_human` once the reviewer has asked for changes `maxReviewRounds` times |
| `needs_human` | `needs_human`, with the reviewer's question |

The server refuses `approve` while a `blocker` or `major` finding is open, and
`request_changes` without at least one open finding.

## Verification

Before any review, the built-in verifier runs the project's commands and the approved
plan's checks in the task's worktree (see [runner.md](runner.md#verification)). Red goes
back to the coder with the evidence; red `maxVerifyFailures` times in a row, or tests
weakened twice, goes to a person. Touching protected paths or a large diff raises the
risk to high. Green continues to the review gate of the level.

## Findings

Reviewers submit structured findings: `severity` (`blocker`, `major`, `minor`,
`nit`), optional `file` and `line`, and text. Each gets an id, `R<round>-<n>`
(for example `R2-3`), stored in the `task_findings` table and shown on the task
page. The next review verifies earlier findings by id (`verifiedFindings`:
`verified` or `open`); the coder answers them by id in the code message.

## Escalations

| Trigger | Result |
|---|---|
| Review rounds reach `maxReviewRounds` (3) | `needs_human` with the open findings |
| The reviewer returns `needs_human` | `needs_human` with its question |
| An agent calls `report_blocker` | `needs_human` with its reason and question |
| Verification red `maxVerifyFailures` (2) times, or tests weakened twice | `needs_human` |
| The reviewer reopens a finding the coder answered, twice | `needs_human` to arbitrate |
| A runner job ends `AGENTQ_MAX_REVERTS` (3) times without submitting | `needs_human` with the last output |
| No eligible reviewer picks up a review within `reviewStarvationMin` (20 min) | `waiting_code_review` (a person reviews) |
| No eligible critic picks up a plan within `reviewStarvationMin` | `waiting_plan_review` (a person approves) |
| Plan critiques reach `maxPlanRounds` (2), or the plan has a blocking question | `needs_human` |
| The task's PR is closed on GitHub without merging | `needs_human` (reopen it, send the task back to `approved` for a new PR, or cancel) |

Answering a `needs_human` task (task page → answer + next status) records the
answer in the conversation and resets the round limits, so the agents get a
fresh set of rounds.

## Pull requests

The task ends on GitHub. After the review the agent with the `pr` role pushes the branch and opens
the PR with the body AgentQ writes (`brief.pr.body`: summary, each acceptance criterion
with its evidence, the verification, the AI review and the findings it addressed, the
risk), then calls `submit_pr`: the task waits in `pr_open`. The human review happens on
the PR, where the diff and CI are.

With the `gh` CLI installed and logged in, the web server checks every open PR each
`AGENTQ_PR_SYNC_SEC` (180 s; `AGENTQ_PR_SYNC=0` turns it off):

| On GitHub | Task |
|---|---|
| Merged | `complete`, credited to the person who merged it (archived too when the project's `autoArchive` is on) |
| Closed without merging | `needs_human` |
| Open | Stays in `pr_open`; the task page shows its checks and who asked for changes |

Without `gh` nothing changes by itself (`/api/meta` says so): a person clicks **Mark
merged** on the task page.

**L3 auto-merge.** With `autonomy: 3` and `autoMerge: true`, the sync merges a PR
itself (`gh pr merge --squash`) when the task is **low risk**, every check is green and
no one asked for changes on GitHub. Anything else waits for a person.

## What needs you

The **Needs you** page lists every task waiting for a person, grouped by what they must
do and oldest first: answer a blocker, approve a plan (medium or high risk), review code
(high risk, a spot check, or no reviewer available), merge a PR, or refine a draft that
is not ready. On a code review the task page shows the AI verdict, the verification, the
diff size, the risk and the criteria in one panel; answered findings can be ticked to
reopen them with the change request, which becomes a finding (`H<round>-<n>`) the coder
must answer by id.

## Metrics

**Activity** shows how the flow is doing (`GET /api/metrics`, filterable by `projectId`,
`from`, `to`):

| Metric | Target |
|---|---|
| Human decisions per task (approvals, change requests, answers, completions) | ≤ 2 at L2 |
| Tasks that reached the PR with no human decision on the way | > 70% |
| AI review rounds per task that reached a PR | ≤ 1.5 |
| Tasks that went through `needs_human` | 10–20% |
| AI-approved tasks a person still sent back (in AgentQ or on GitHub) | < 10% |
| Runner reverts per task | falling |
| Lead time from creation to completion | — |

## Separation of duties

Nobody reviews code they wrote. Each claim carries a `sessionKey`:
`runner:<runnerId>` for runner claims (stable across jobs), `mcp:<instance>` for
agents that claim through their own MCP session. Every submit records who
produced the artifact (`task.producers`), and a claim of `code_review_requested`
skips tasks whose code was produced under the same `sessionKey`; a claim of
`plan_review_requested` skips plans the same session wrote. With
`requireDifferentModel`, the reviewer's model must also differ from the coder's.

With a single runner that has both `code` and `review` on an L1+ project, reviews
therefore wait for a second runner with the `review` role, and go to
a person after `reviewStarvationMin`.

### Independent checks

A separate session is not enough if the checker reads the author's reasoning:
it then tends to agree with it. So the three phases that check another agent's
work (plan critique, verification, code review) start clean. Their agent gets
an **independent brief** (`buildIndependentBrief` in
`packages/shared/src/brief.ts`) instead of the usual one:

| Gets | Never gets |
| ---- | ---------- |
| The task: description, steer details, non-goals, references, branches, worktree, head commit | The task's conversation and `contexts` |
| The criteria and how each is checked | The author's view of which criteria are met, and its evidence |
| The guardrails, conventions and project commands | The handoffs (`context`, `decisions`, `risks`, `next`) of every phase |
| The approved plan (review, verification), or the plan under critique with its validation plan and declared paths, questions and risk | The author's submission message and comments |
| The earlier findings of the phase to verify by id, with the author's reason for each `wontfix` | The author's answer to findings it says it fixed |
| What people decided (answers to blockers, change requests) and wrote since the last submission | |
| The verifier's result on the submitted commit (review only) | |

The MCP server enforces it for the session that holds the claim (a runner job's
server holds its job's claim): `claim_task`, `get_task_brief`, `get_task`,
`list_tasks`, `post_comment` and `agentq://task/{taskId}` all return the
independent view. Anyone else, a person's session included, still reads the
whole task. The checkers' own handoffs still reach the agent that acts on their
verdict (the planner or the coder).

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `maxPlanRounds` | 2 | Plan critiques that may ask for changes before a person decides |
| `maxReviewRounds` | 3 | AI reviews that may ask for changes before a person decides |
| `maxVerifyFailures` | 2 | Consecutive red verifications before a person decides |
| `requireDifferentModel` | false | The reviewer must use a different model than the coder |
| `humanSampleEvery` | 0 | Every Nth AI approval in the project also goes to a person (0 = never) |
| `reviewStarvationMin` | 20 | Minutes a review may wait for an eligible reviewer (0 = never hand it over) |
| `leaseMin` | 90 | Minutes a hand-opened agent session may stay silent before its claim expires |
| `autoMerge` | false | L3: merge a green, low-risk PR without a person |

## Risk and task types

Tasks have a `type` (`feature`, `bug`, `refactor`, `docs`, `chore`) and a
`risk` (`low`, `medium`, `high`). The risk defaults from the type (docs and
chores are low, the rest medium) and a person can change it. High risk means a
person also reviews the code after an AI approval.

## Leases and the sweeper

Runner claims end with their process. Claims made by hand-opened sessions have
a lease (`leaseMin`): any AgentQ call from the session extends it, and
`heartbeat` extends it during long silent work. The web server sweeps every
minute (and before each MCP claim): expired claims go back to the queue, and
reviews nobody eligible picked up go to a person. On start, the server also
returns tasks held by runner jobs that did not survive the restart.
