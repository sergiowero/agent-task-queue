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
| **L2 Human PR** (default) | Person* | AI reviewer | Person | Most tasks |
| **L3 Autonomous** | Person* | AI reviewer | Person, or auto-merge when green and low risk | Docs, tests, chores |

\* An AI plan critic replaces the person for low-risk plans in a later phase
of the roadmap; until then every plan is approved by a person.

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
| A runner job ends `AGENTQ_MAX_REVERTS` (3) times without submitting | `needs_human` with the last output |
| No eligible reviewer picks up a review within `reviewStarvationMin` (20 min) | `waiting_code_review` (a person reviews) |

Answering a `needs_human` task (task page → answer + next status) records the
answer in the conversation and resets the round limits, so the agents get a
fresh set of rounds.

## Separation of duties

Nobody reviews code they wrote. Each claim carries a `sessionKey`:
`runner:<runnerId>` for runner claims (stable across jobs), `mcp:<instance>` for
agents that claim through their own MCP session. Every submit records who
produced the artifact (`task.producers`), and a claim of `code_review_requested`
skips tasks whose code was produced under the same `sessionKey`. With
`requireDifferentModel`, the reviewer's model must also differ from the coder's.

With a single `senior` runner on an L1+ project, reviews therefore wait for a
second runner that can review (`reviewer`, `architect` or `senior`), and go to
a person after `reviewStarvationMin`.

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
