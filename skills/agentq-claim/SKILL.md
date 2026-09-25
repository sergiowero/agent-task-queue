---
name: agentq-claim
description: Entry point for working as an AgentQ agent through the AgentQ MCP server. Use when asked to work the AgentQ queue, claim or pick up tasks, act as an AgentQ agent for one or more roles (refine, plan, plan_review, code, verify, review, pr), or run the claim → work → submit loop. It claims a task with the `claim_task` MCP tool, then routes you to the phase skill (agentq-refine, agentq-plan, agentq-plan-review, agentq-code, agentq-verify, agentq-review, agentq-pr) that matches the task status.
allowed-tools: mcp__agentq__claim_task, mcp__agentq__get_task, mcp__agentq__get_task_brief, mcp__agentq__get_skill, mcp__agentq__post_comment, mcp__agentq__report_blocker, mcp__agentq__heartbeat
metadata:
  version: "6.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Claim Skill

Router skill: claim a task, then follow the phase skill for its status. Per-phase rules (working directory, worktree, git, message template, submit tool) live in the phase skills.

**MCP conventions**: all queue work goes through the tools of the `agentq` MCP server. Your client prefixes their names (in Claude Code `claim_task` is `mcp__agentq__claim_task`). Use `claim_task`, the `submit_*` tools and `report_blocker`; `get_task` and `post_comment` are there to re-read or annotate the task you claimed. Every `submit_*` call MUST pass `context` with handoff notes for the next agent (the tool rejects a submit without it) — see Context Handoff. Every `message` MUST be Markdown (templates are in the phase skills).

If the `agentq` tools are missing, the server is not registered: tell the user to run `bun run install:mcp` from the AgentQ checkout, then restart the tool. Do not work around it.

## Identity

- **toolName**: name of the invoking tool (e.g. `opencode`, `claude`, `codex`, `kimi`, `junie`)
- **version**: Current tool version from configuration
- **model**: Current model from configuration
- **sessionId**: Current session ID from the invoking tool (do not generate)
- **roles**: the phases you work, one or more, as the user asks at skill invocation (e.g. "work as plan and review" → `["plan", "review"]`). When the user names none, **omit `roles`**: the server gives you every role but `verify` (it has a built-in verifier).

| Role | Claims | Phase skill |
|------|--------|-------------|
| `refine` | `draft` | `agentq-refine` |
| `plan` | `plan_requested`, `plan_changes_requested` | `agentq-plan` |
| `plan_review` | `plan_review_requested` | `agentq-plan-review` |
| `code` | `ready_for_code`, `changes_requested` | `agentq-code` |
| `verify` | `verify_requested` | `agentq-verify` |
| `review` | `code_review_requested` | `agentq-review` |
| `pr` | `approved` (push the branch, open the PR) | `agentq-pr` |

## Claim a Task

Call `claim_task`:

```json
{ "toolName": "<toolName>", "version": "<version>", "model": "<model>", "roles": ["<role>", "..."], "sessionId": "<sessionId>",
  "skillsVersion": "6.0.0",
  "host": "<host, optional>", "projectId": "<only claim from this project, optional>", "context": "<notes, optional>" }
```

`skillsVersion` is the `metadata.version` of this skill. The server refuses outdated skills with `reason: "skills_outdated"`.

**Result (success)**: the task (without its conversation and history), a `brief`, the `phaseSkill` to follow (name and version), your `agent` identity and a `claimToken`. Keep `task.id` and `claimToken`: pass both to every `submit_*` and `report_blocker` call for this task (the server rejects submits from anyone else, e.g. a stale session after a person unblocked the task).
```json
{ "success": true,
  "task": { "id": "...", "title": "...", "description": "...", "steerDetails": "...", "guardrails": ["..."],
    "acceptanceCriteria": [{ "id": "AC1", "text": "...", "verify": { "kind": "command", "command": "bun test x" }, "status": "pending" }], "status": "coding", "recommendedBranch": "feat/...", "mergeBranch": "main",
    "worktreePath": null | "{project}/.agentq/worktrees/{taskId}",
    "history": [{ "pre_status": "ready_for_code", "new_status": "coding", "timestamp": "..." }],
    "conversation": [{ "authorName": "...", "timestamp": "...", "message": "...", "messageType": "review" }], "contexts": ["..."],
    "findings": [{ "id": "R1-1", "severity": "major", "file": "src/a.ts", "line": 12, "text": "...", "status": "open" }],
    "evidence": [{ "id": "E1", "criterionId": "AC1", "command": "bun test", "exitCode": 0, "summary": "..." }],
    "approvedPlan": { "markdown": "...", "validation": { "items": [...], "regressionCommands": ["bun test"] } } | null,
    "project": { "id": "...", "displayName": "...", "workingDirectory": "/path/to/project" } },
  "agent": { "id": "opencode@1.0|model", "role": "code" },
  "claimToken": "<secret for this claim>", "skillsVersion": "6.0.0" }
```

`agent.role` is the one of your roles this claim acts as.

For a plan critique, a verification or a code review (see Independent Checks), `task` is only the brief's task summary with its `project` (`"independent": true`): no conversation, contexts, handoffs, evidence or criteria status.

**Result (no tasks):** `{ "success": false, "reason": "no_tasks_available", "message": "No tasks available for your roles." }`

**Result (outdated skills):** `{ "success": false, "reason": "skills_outdated", ... }` — stop and tell the user to run `bun run install:skills` in the AgentQ checkout. Do the same if the server's instructions name a newer skills bundle than this skill's version.

**Errors** come back as `{ "success": false, "error": "..." }` with the tool call marked as an error.

**Separation of duties**: you never get the review of code your own session wrote (and, when the project requires it, not with the coder's model either). If your roles include both `code` and `review`, you may therefore find no tasks while your code waits for another agent's review: that is expected.

**Lease**: a claim from a hand-opened session expires after the project's lease (90 min by default) without any AgentQ call, and the task goes back to the queue. Every AgentQ tool call keeps it alive; during a long silent stretch (a long build or test run), call `heartbeat` with the `taskId`.

## Protocol

1. **Claim** a task with `claim_task`
2. **Read** the task status from the result
3. **Determine phase** from the status (see Phase Routing) and read that phase skill
4. **Work** on the task according to the phase skill
5. **Submit** with the `submit_*` tool given by the phase skill — or, if something outside your control blocks the phase, call `report_blocker` (see Blocked)
6. **Repeat** until no tasks available

If an AgentQ runner started you, the task was **already claimed by the runner**: skip steps 1–2 and 6, do not call `claim_task`, work on the task you were given and submit once.

## Phase Routing

The claim moves the task to its in-progress status; route on the status it was claimed from (the last `history` entry's `pre_status`) or on the in-progress status:

| Claimed from | In progress | Role | Phase | Skill to read next |
|--------------|-------------|------|-------|--------------------|
| `draft` | `refining` | `refine` | Refining | `agentq-refine` |
| `plan_requested` | `planning` | `plan` | Planning | `agentq-plan` |
| `plan_changes_requested` | `planning` | `plan` | Planning | `agentq-plan` |
| `plan_review_requested` | `plan_reviewing` | `plan_review` | Plan critique | `agentq-plan-review` |
| `ready_for_code` | `coding` | `code` | Coding | `agentq-code` |
| `changes_requested` | `coding` | `code` | Coding | `agentq-code` |
| `verify_requested` | `verifying` | `verify` | Verifying | `agentq-verify` |
| `code_review_requested` | `reviewing` | `review` | Reviewing | `agentq-review` |
| `approved` | `merging` | `pr` | Pull request | `agentq-pr` |

`claim_task` also returns `phaseSkill` with the name to follow.

After claiming, read the skill for the phase and follow it. Do not read the other phase skills.

## Context Reading

Start from the **brief** (`brief` in the `claim_task` result, or `get_task_brief`). It holds, in a fixed size whatever the number of rounds:

- `task`: description (what, functional only), steerDetails (how), nonGoals (what not to do), references (where to look first), type and risk
- `typeGuidance`: what this kind of task needs (e.g. a bug starts with a failing test)
- `guardrails`: the project's shared ones and the task's (hard constraints), the project's `commands`
- `criteria` with ids and status, the `approvedPlan` (or `latestPlan` while none is approved)
- `openFindings`, the latest `handoffs` of each phase, `humanNotes` (what people wrote since the last submission), `round`, `verification` (with the failing commands), `lastAnswer` (a person's answer to a blocker)

Call `get_task` only when you need the whole conversation or history. If your installed phase skill is older than `phaseSkill.version`, read the current text with `get_skill`.

### Independent Checks

The plan critique (`plan_reviewing`), the verification (`verifying`) and the code review (`reviewing`) check another agent's work, so their agent starts clean. Their brief is an **independent brief** (`brief.independent: true`): the task, the criteria and how each is checked (without the author's view of which are met), the plan, the guardrails, the project's commands, the findings to verify by id, and what people decided (`humanDecisions`) or wrote (`humanNotes`). It leaves out the conversation, the handoffs, and the author's messages and evidence, and `brief.isolation` says how to check the work instead. While you hold such a task, `get_task`, `list_tasks`, `post_comment` and the task resource show the same view. Judge the work itself: do not look for the author's context.

Agents MUST respect guardrails — they define hard constraints that must not be violated during implementation. If a guardrail conflicts with other requirements, the guardrail takes precedence.

## Context Handoff

Handoffs are how agents pass knowledge to the agents that continue the work (refine → plan → code → code of the next round → pr). Each `submit_*` call records one: `context` (a short summary, **required**, never blank) plus optional lists `decisions`, `risks` and `next`. The brief shows the latest handoff of each phase. The independent checks (`plan_review`, `verify`, `review`) never read handoffs, but they write one for the agent that acts on their verdict.

- Write what the next agent needs and cannot get cheaply from the diff or the `message`: decisions and why, gotchas, where to look first, what is left or risky. Do not repeat the `message`.
- Keep it short (1–5 sentences) and concrete: file paths, function names, commands.
- Each phase skill says what its handoff should contain. Put choices in `decisions`, doubts in `risks`, and what the next agent should do first in `next`.
- `context` on `claim_task` is optional — pass it only if you already know something worth recording.

## Blocked

When you cannot finish the phase for a reason you cannot fix yourself — a push or `gh` call rejected, missing credentials or tools, a task whose requirements contradict each other or the guardrails — call `report_blocker`:

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "reason": "<what blocks you, with the error output>",
  "question": "<the one question or action a person must answer or take>", "context": "<what you tried, optional>" }
```

The task moves to `needs_human`, your claim is released and no agent retries it until a person answers. Never submit partial or placeholder work to move a task forward, and never "stop and tell the user" without calling `report_blocker`: a runner has no user watching.

## Autonomy

Agents MUST NOT ask the user for permission or confirmation during task execution — no "should I start working on this task?", no "is this plan correct?" before submitting, no "should I proceed?" / "do you want me to continue?", no asking for approval before implementing changes. The workflow is: claim → work → submit → repeat. The agent decides based on the task description and acceptance criteria. If the task is unclear, use reasonable judgment and submit with notes explaining assumptions; only when no reasonable reading exists, use `report_blocker`. The user reviews the result via AgentQ's review flow, not during execution.

## Guardrails

- **NEVER** use API calls (HTTP/curl/fetch) — use the AgentQ MCP tools only (`claim_task`, `submit_*`, `report_blocker`)
- **DO NOT** use `list_tasks`, `create_task` or `archive_task` in this loop — agents claim, work on the claimed task and submit
- **DO NOT** manage state or generate session IDs
- **DO NOT** retry indefinitely on empty queue — **STOP** and inform user when no tasks available
- **DO NOT** skip phases or jump to other tasks - follow the status-driven phase and focus only on the claimed task until submitted
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit

## No Tasks Available

When `claim_task` returns `{ "success": false, "reason": "no_tasks_available" }`: stop immediately, inform the user "No tasks available for your roles.", and do NOT retry or loop.
