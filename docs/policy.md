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
person); needs_human asks a person. The planner answers each open finding by id
in its revision (`findingResolutions`: `fixed`, or `wontfix` with the reason; a
revision that leaves one unanswered is refused), and the critic verifies each
answer. The brief's `round.remainingPlanRounds` says how many critiques may still
ask for changes. A **blocking open question** in the plan
sends the task to a person before any critique. The planner's `suggestedRisk` and
`touchedPaths` can only raise the risk (protected paths make it high). A task with
acceptance criteria needs a `validationPlan` with at least one item per criterion
(waived ones excepted; an item with only `how` is a manual check); the portal shows it
while the plan waits for a person, and flags criteria without a check.

**Size.** One task is one reviewable PR. The project's `maxDiffLines` (400),
`maxPlanFiles` (10) and `maxCriteria` (6) reach the planner and the critic as
`brief.sizeLimits`. A plan that touches more files, or a task with more criteria,
without creating subtasks (or a plan that proposes subtasks it did not create) is
submitted with `planSubmission.sizeWarnings`: the critic sees them next to the
subtasks the plan created, and the task page shows them. They are warnings, not
refusals.

## Subtasks and drafts

A planner can split a task with `create_subtask` (with `blockedBy` naming earlier
subtasks for order; never the task being split, whose completion waits for them,
nor a canceled task). The subtasks are held until the parent's plan is approved
(by a person, by the critic, or by a person resolving the plan's blocker to
`ready_for_code`); then they run like any task (a blocked one waits for its
dependencies to be complete) and the parent, in `split`, completes when they are
all finished. Re-planning drops the held subtasks of the previous plan.

- **Canceling a task cancels its unfinished subtasks** (their runner jobs are stopped).
- **A dependency that will never complete** (canceled or deleted) sends each task
  queued after it to `needs_human`. Resolving that blocker drops the dead
  dependency, so the task can be claimed again; or cancel it.
- **A split task whose subtasks were all canceled** goes to `needs_human`: send it
  back to planning, code it as one task, or cancel it.

A task created as a **draft** waits for an agent with the `refine` role to make it ready
(criteria, type, risk, scope) or for a person to promote it.

**Requires plan.** A person can change `requiresPlan` while nothing has started the
task (`draft`, `plan_requested`, `ready_for_code`): turning it on sends a
ready-for-code task without an approved plan to `plan_requested`, turning it off
sends a task still waiting for its first plan to `ready_for_code`. The refiner's
choice is stored the same way.

L0 reproduces the original behaviour exactly: the reviewer's verdict is advice
and a person approves or requests changes.

## Definition of Ready

Each project checks new tasks against a Definition of Ready (`dorMode`: `warn`
stores the problems on the task, `enforce` refuses the task, `off` skips it):
a real description, acceptance criteria and at least one that says how it is
verified, a plan for high-risk work, reproduction steps for a bug, and something
that can verify the task (the project's commands or a criterion's command; with
neither, it would reach review not verified). The same check runs on every
edit, on the refiner's `submit_refinement` (under `enforce` it is refused while
problems are left, unless the refiner asks a blocking question), on a person's
**Promote** (kept as warnings) and on each `create_subtask` (under `enforce` an
unready subtask is refused). Drafts are exempt until they are promoted or refined.

## Editing a task

A person edits a task's fields from the portal (`PUT /api/tasks/:id`) only while no
agent holds it: in planning, coding, verifying, reviewing or merging, with a PR open,
or once it is complete or canceled, the server answers `409` (unblock the task first).
The acceptance criteria are frozen with the approved plan: changing them needs the
task back in planning (the next approval freezes the new ones). A criterion reworded
in place keeps its id, so the validation plan and the evidence still point at it (its
status starts over).

## Code review routing (L1–L3)

`submit_code` sends the task to `code_review_requested` without a click. The
reviewer's `submit_review` verdict routes it:

| Verdict | Goes to |
|---|---|
| `approve` | `approved` (the PR phase) — or `waiting_code_review` when the task is **high risk** or the approval is **sampled** for a human spot check |
| `request_changes` | `changes_requested`, with the findings by id — or `needs_human` once the reviewer has asked for changes `maxReviewRounds` times |
| `needs_human` | `needs_human`, with the reviewer's question |

The server refuses `approve` while a `blocker` or `major` finding is open, or answered
by the coder (`fixed`, `wontfix`) but not yet verified: the reviewer closes those with
`verifiedFindings` (`verified`) or requests changes. It also refuses `request_changes`
without at least one open finding. The same holds for a plan critique's `approve`.

## Verification

Before any review, the built-in verifier runs the project's commands and the approved
plan's checks in the task's worktree (see [runner.md](runner.md#verification)). Red goes
back to the coder with the evidence; red `maxVerifyFailures` times in a row, or tests
weakened twice, goes to a person. A run where no command that checks the code ran is
"not verified", never green. Touching protected paths or a large diff raises the risk
to high. Green continues to the review gate of the level.

The diff guards do not depend on the verifier: on every `submit_code` and
`submit_verification` the server reads the worktree's diff itself. Protected paths or a
diff over `maxDiffLines` raise the risk to high, and weakened tests send the code back
(to a person on the second strike), with or without project commands, with the
verifier down, and for agent verifiers. Under L3, auto-merge also checks the PR's own
files on GitHub.

## Findings

Reviewers submit structured findings: `severity` (`blocker`, `major`, `minor`,
`nit`), optional `file` and `line`, and text. Each gets an id, `R<round>-<n>`
(for example `R2-3`), stored in the `task_findings` table and shown on the task
page. The next review verifies earlier findings by id (`verifiedFindings`:
`verified` or `open`); the coder answers the open code findings by id
(`findingResolutions`: `fixed` or `wontfix` with the reason). Plan findings and
findings already verified cannot be answered again.

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
| The task's PR is closed on GitHub without merging | `needs_human` (reopen it, send the task back to `approved` for a new PR or to the coder, or cancel) |
| A task it starts after is canceled or deleted | `needs_human` (drop the dependency, or cancel) |
| Every subtask of a split task was canceled | `needs_human` (re-plan, code it as one task, or cancel) |

Answering a `needs_human` task (task page → answer + next status) records the
answer in the conversation and resets the round limits, the consecutive verification
failures and the tamper strikes, so the agents get a fresh set of rounds. Sending a
tampering blocker on (to verification or review) accepts those test changes: they are
not flagged again on later rounds. The statuses offered depend on the phase it was
blocked in:

- A blocker in **planning or plan critique** sent to `ready_for_code` approves the
  plan, like **Approve plan**: the plan and its validation are frozen, and the
  subtasks it created start (the task waits in `split`).
- A blocker in **coding, verification or review** can go back to
  `plan_changes_requested` when the approved plan itself is wrong (a test it names
  cannot exist, a criterion cannot be checked as planned). The approved plan stays
  until the planner's next one is approved. From a code review, **Re-plan** does the
  same.

An escalated **review or verification** (round limit, disagreement, the reviewer's
question, verification failures, weakened tests) is decided like a code review: the
task page shows the same panel above the answer box, with the AI verdict, the findings
by round, the verification, the diff size, the risk and the criteria. The answer can

- **reopen** findings (tick an answered one) and go back to the coder (`changes_requested`):
  the answer becomes a change request, a finding `H<round>-<n>` the coder must answer by id;
- **accept** open findings (tick them; `wontfix`, noted "accepted by <person>", keeping the
  coder's reason) so nobody has to fix them, and send the code on: **Approved** for the
  coder's disputed `wontfix`, or another review;
- or just answer and pick a status, as for any blocker.

`POST /api/tasks/:id/resolve-blocker` takes `findingIds` (reopen: code findings with
`changes_requested`, plan findings with `plan_changes_requested`), `waiveFindingIds`
(accept: open findings only) and `asFinding` (record the answer as a change request;
default on for a review or verification escalation sent back to the coder, off for a
coder's own question). A choice the workflow refuses (an unknown or answered finding,
a finding of the other phase) changes nothing. **Request changes** on a plan waiting for
a person takes `findingIds` too, to reopen plan findings the planner must answer again.

## Pull requests

The task ends on GitHub. After the review the agent with the `pr` role pushes the branch and opens
the PR with the body AgentQ writes (`brief.pr.body`: summary, each acceptance criterion
with its evidence, the verification, the review, the risk), then calls `submit_pr`: the
task waits in `pr_open`. The review section gives the latest AI verdict with the commit it
saw (or says it was about an earlier submission, when the code changed since and no AI
reviewed it again), the person who approved the code when a person did, the findings
addressed, and the open findings: blocker and major ones apart ("a person accepted"),
since only a person can approve code with those open, then the non-blocking ones. The human review happens on
the PR, where the diff and CI are.

With the `gh` CLI installed and logged in, the web server checks every open PR each
`AGENTQ_PR_SYNC_SEC` (180 s; `AGENTQ_PR_SYNC=0` turns it off). Its `gh` calls run in the
background, one at a time, and each is killed after `AGENTQ_PR_SYNC_TIMEOUT_SEC` (30 s),
so a slow or stuck GitHub never holds up the server:

| On GitHub | Task |
|---|---|
| Merged | `complete`, credited to the person who merged it (archived too when the project's `autoArchive` is on) |
| Closed without merging | `needs_human` |
| A reviewer asks for changes (their latest review, submitted since the task entered `pr_open`) | `changes_requested`: the review becomes a finding the coder answers by id |
| Open | Stays in `pr_open`; the task page shows its checks and who asked for changes |

Without `gh` nothing changes by itself (`/api/meta` says so): a person clicks **Mark
merged** on the task page.

**Changes on the PR.** The PR is where a person reviews the code, so its feedback goes
back to the coder: a change request on GitHub (picked up by the sync) or **Request
changes** on the task page (`POST /api/tasks/:id/request-pr-changes`, which works without
`gh` too) moves the task from `pr_open` to `changes_requested`. The request becomes a
finding (`H<round>-<n>`) the coder must answer by id, like a change request on the code
review. The PR stays open and stays on the task: the coder commits on the same branch,
the code goes through verification and review again, and the `pr` phase pushes to the
same PR and refreshes its body instead of opening a new one. A request the coder already
got is not sent again while it stays on GitHub; it keeps holding back the L3 auto-merge
until the reviewer approves or dismisses it.

With `autoArchive` on, every way a task completes through its PR archives it: a merge
the sync sees, an L3 auto-merge and **Mark merged**. When archiving fails (for example
the project folder moved), the task stays complete and its activity shows an
`archive_failed` event with the reason.

**Only the approved commit ships.** Every approval (the AI reviewer's, a person's
**Approve code**, or a person answering a review blocker with `approved`) records who
approved and which commit (`task.approval`: the worktree's `HEAD`, else the submitted
commit). The `pr` phase gets it as `brief.pr.commit` and never commits leftovers itself.
A `submit_pr` whose pushed commit is not the approved one (commits nobody verified or
reviewed) goes to `needs_human` with the PR recorded: send the task back to the coder,
accept the PR as it is (`pr_open`), or cancel it.

**L3 auto-merge.** With `autonomy: 3` and `autoMerge: true`, the sync merges a PR
itself (`gh pr merge --squash --match-head-commit <head>`) when the task is **low
risk**, every check is green, no reviewer's latest review asks for changes (only each
reviewer's newest approve, request-changes or dismissal counts; a later comment does not
clear a change request) and the PR's head (`headRefOid`) is the approved commit. A head
with commits pushed after the approval is reported in the sync's errors and never merged;
`--match-head-commit` makes GitHub refuse a commit that lands in between.
Anything else waits for a person. The metrics still count a change request that was
approved later.

## What needs you

The **Needs you** page lists every task waiting for a person, grouped by what they must
do and oldest first: answer a blocker, approve a plan (medium or high risk), review code
(high risk, a spot check, or no reviewer available), merge a PR, or refine a draft that
is not ready. On a code review the task page shows the AI verdict (marked "before the
last change" when the code was submitted again since), the verification, the diff size,
the risk and the criteria in one panel; answered findings can be ticked to
reopen them with the change request, which becomes a finding (`H<round>-<n>`) the coder
must answer by id. Under L0 an AI review is advice, so a reviewer that cannot decide
(verdict `needs_human`) cannot raise a blocker: the task returns to the person's review with
the question in the panel, in the conversation and as a `review_escalated` event.

A plan waiting for a person, and a blocked plan, have a panel of their own: the plan itself,
the AI critic's review of it and the critique count (`P1/2`), the risk, the plan findings (tick
one to have the planner answer it again) and **the commands an approval lets the verifier
run**: each validation item's command and new tests, the regression commands, and the commands
of the acceptance criteria. A command that is not one of the project's and not on the verify
allowlist is flagged ("not allowlisted": it runs only because a person approved the plan), and
so is one that chains commands (`;`, `&&`, `||`, `|`, backticks, `$( )`). A plan without a
validation plan says so. **Request changes** needs something to say, feedback or findings to
reopen: an empty request is not sent.

**The board** lists every task of the selected project, not just the first 50. Its cards show
`R2/3` (AI reviews used against `maxReviewRounds`) and, while a plan is written, critiqued or
decided, `P1/2` (plan critiques against `maxPlanRounds`), both counted from the person's last
answer as the routing counts them, and say why a queued task is not picked up: **held: plan
pending** (a subtask whose parent's plan is not approved) or **waits for N tasks**. A split
parent can be canceled from its page, which cancels its unfinished subtasks too.

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

Nobody critiques their own plan, or verifies or reviews their own code. Each
claim carries its identities (`assignedAgent.identities`, the primary one also as
`sessionKey`):

- a runner claim is its runner, `runner:<runnerId>`, the same for all its jobs;
- a claim through MCP is its conversation, `session:<tool>:<sessionId>` (the tool
  name in one spelling, so `Claude Code` and `claude` are one tool), plus the MCP
  server process it came through, `mcp:<instance>`. A restarted or resumed MCP
  server is therefore still the same agent, and so is a server whose agent passed
  another sessionId. A placeholder sessionId (`unknown`, `<sessionId>`, `n/a`, all
  zeros…) names no conversation and is left out, so it does not lump every such
  session together; the claim is then only its server process.

Every submit records who produced the artifact (`task.producers`), adding to the
producers of the earlier rounds. A claim of `plan_review_requested` skips plans,
and a claim of `verify_requested` or `code_review_requested` skips code, that any
of the claim's identities produced in any round: the round-1 coder does not
review round 2 after someone else fixed it, since its commits are still on the
branch. The built-in verifier (`runner:builtin:verifier`) never produces code, so
it always may verify.

With `requireDifferentModel`, the checker's model must also differ from the model
of every producer. Models are compared as model keys: case, provider prefixes
(`anthropic/`, `us.anthropic.`), date and version suffixes and context tags
(`[1m]`) are dropped, and a Claude model counts as its family (`opus`,
`claude-opus-4-5` and `anthropic/Opus` are one model). A blank or `default` model
is the tool's own default, so it is tool-scoped: a Claude runner and a Codex
runner with no model may check each other.

With a single runner that has both `code` and `review` on an L1+ project, reviews
therefore wait for a second runner with the `review` role (on another model under
`requireDifferentModel`), and go to
a person after `reviewStarvationMin`. The Runners page warns, per project, when no
enabled runner may take the review of some runner's code or the critique of its
plans.

A runner job's MCP server starts out holding the job's claim and does not offer
`claim_task`: a claim from it would not carry the runner's identity, so the job
could otherwise take the review of the code it just submitted.

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
server holds its job's claim): `claim_task`, `get_task_brief`, `get_task` and
`agentq://task/{taskId}` all return the independent view, and `list_tasks` (task
summaries) and `post_comment` (the entry it added) return nothing of the task's
context to anyone. Anyone else, a person's session included, still reads the
whole task with `get_task`. The checkers' own handoffs still reach the agent that acts on their
verdict (the planner or the coder).

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `maxPlanRounds` | 2 | Plan critiques that may ask for changes before a person decides |
| `maxReviewRounds` | 3 | AI reviews that may ask for changes before a person decides |
| `maxVerifyFailures` | 2 | Consecutive red verifications before a person decides |
| `requireDifferentModel` | false | The plan critic, verifier and reviewer must use a different model than whoever wrote the plan or code (see Separation of duties) |
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
