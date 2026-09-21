---
name: agentq-workflow
description: Entry point for working as an AgentQ agent through the `agentq` CLI. Use when asked to work the AgentQ queue, claim or pick up tasks, act as an AgentQ agent (planner, implementer, reviewer, senior, architect), or run the claim → work → submit loop. It claims a task with `agentq claim --json`, then routes you to the phase skill (agentq-plan, agentq-code, agentq-review, agentq-merge) that matches the task status.
allowed-tools: Bash(agentq:*)
metadata:
  version: "2.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Workflow Skill

Router skill: claim a task, then follow the phase skill for its status. Per-phase rules (working directory, worktree, git, message template, submit command) live in the phase skills.

**CLI conventions**: use only `agentq claim`, `agentq heartbeat` and `agentq submit-*`, always with `--json`. Include `--context "<short summary of current state, findings, or blockers>"` on every `agentq claim` and `agentq submit-*` so the next agent has context. All `-m` messages MUST be in Markdown format (templates are in the phase skills).

## Identity

- **toolName**: name of the invoking tool (e.g. `opencode`, `claude`, `codex`, `kimi`, `junie`)
- **version**: Current tool version from configuration
- **model**: Current model from configuration
- **sessionId**: Current session ID from the invoking tool (do not generate)
- **role**: Specified by user at skill invocation, default: `senior`

## Claim a Task

```bash
agentq claim -n <toolName> -v <version> -m <model> -r <role> -s <sessionId> \
  [--host <host>] [--project <projectId>] [--context "<summary>"] --json   # --project restricts the claim to one project
```

**Response (success)** — the full task plus `project` and your `agent` identity. Keep `task.id` and `agent.id`: the phase skills need them for `agentq heartbeat` and `agentq submit-*`. A claim holds a lease (default 15 min, see `task.leaseExpiresAt`); the phase skills tell you when to extend it.
```json
{ "success": true,
  "task": { "id": "...", "title": "...", "description": "...", "steerDetails": "...", "guardrails": ["..."],
    "acceptanceCriteria": ["..."], "status": "ready_for_code", "recommendedBranch": "feat/...", "mergeBranch": "develop",
    "worktreePath": null | "{project}/.agentq/worktrees/{taskId}", "claimedAt": "<ISO>", "leaseExpiresAt": "<ISO>",
    "conversation": [{ "authorName": "...", "timestamp": "...", "message": "...", "messageType": "review" }], "contexts": ["..."],
    "project": { "id": "...", "name": "...", "displayName": "...", "workingDirectory": "/path/to/project" } },
  "agent": { "id": "opencode@1.0|model", "role": "senior" } }
```

**Response (no tasks):** `{ "success": false, "reason": "no_tasks_available", "message": "No tasks available for your role." }`

## Protocol

1. **Claim** a task using `agentq claim --json`
2. **Read** the task status from the response
3. **Determine phase** from the status (see Phase Routing) and read that phase skill
4. **Work** on the task according to the phase skill
5. **Submit** using the `agentq submit-*` command given by the phase skill
6. **Repeat** until no tasks available

## Phase Routing

| Task Status | Phase | Skill to read next |
|-------------|-------|--------------------|
| `plan_requested` | Planning | `agentq-plan` |
| `plan_changes_requested` | Planning | `agentq-plan` |
| `ready_for_code` | Coding | `agentq-code` |
| `changes_requested` | Coding | `agentq-code` |
| `code_review_requested` | Reviewing | `agentq-review` |
| `reviewing` | Reviewing | `agentq-review` |
| `approved` | Merging | `agentq-merge` |

After claiming, read the skill for the phase and follow it. Do not read the other phase skills.

## Context Reading

Before working on a task, read `task.description` (functional requirements only — what needs to be accomplished), `task.steerDetails` (technical recommendations, implementation hints, preferred approaches), `task.guardrails` (behavioral constraints, do's and don'ts for agents), `task.acceptanceCriteria` (specific, testable conditions that define completion), `task.conversation[]` (previous discussion) and `task.contexts[]` (additional context).

Agents MUST respect guardrails — they define hard constraints that must not be violated during implementation. If a guardrail conflicts with other requirements, the guardrail takes precedence.

## Autonomy

Agents MUST NOT ask the user for permission or confirmation during task execution — no "should I start working on this task?", no "is this plan correct?" before submitting, no "should I proceed?" / "do you want me to continue?", no asking for approval before implementing changes. The workflow is: claim → work → submit → repeat. The agent decides based on the task description and acceptance criteria. If the task is unclear, use reasonable judgment and submit with notes explaining assumptions. The user reviews the result via AgentQ's review flow, not during execution.

## Guardrails

- **NEVER** use API calls (HTTP/curl/fetch) — use CLI only (`agentq claim`, `agentq heartbeat`, `agentq submit-*`)
- **DO NOT** use `agentq list` or `agentq get` - agents only use `claim`, `heartbeat` and `submit-*`
- **DO NOT** manage state or generate session IDs
- **DO NOT** retry indefinitely on empty queue — **STOP** and inform user when no tasks available
- **DO NOT** skip phases or jump to other tasks - follow the status-driven phase and focus only on the claimed task until submitted
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit

## No Tasks Available

When `agentq claim` returns `{ "success": false, "reason": "no_tasks_available" }`: stop immediately, inform the user "No tasks available for your role.", and do NOT retry or loop.
