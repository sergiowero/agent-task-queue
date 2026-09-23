---
name: agentq-claim
description: Entry point for working as an AgentQ agent through the AgentQ MCP server. Use when asked to work the AgentQ queue, claim or pick up tasks, act as an AgentQ agent (planner, implementer, reviewer, senior, architect), or run the claim → work → submit loop. It claims a task with the `claim_task` MCP tool, then routes you to the phase skill (agentq-plan, agentq-code, agentq-review, agentq-merge) that matches the task status.
allowed-tools: mcp__agentq__claim_task, mcp__agentq__get_task, mcp__agentq__post_comment
metadata:
  version: "3.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Claim Skill

Router skill: claim a task, then follow the phase skill for its status. Per-phase rules (working directory, worktree, git, message template, submit tool) live in the phase skills.

**MCP conventions**: all queue work goes through the tools of the `agentq` MCP server. Your client prefixes their names (in Claude Code `claim_task` is `mcp__agentq__claim_task`). Use `claim_task` and the `submit_*` tools; `get_task` and `post_comment` are there to re-read or annotate the task you claimed. Pass `context` ("<short summary of current state, findings, or blockers>") on every `claim_task` and `submit_*` call so the next agent has context. Every `message` MUST be Markdown (templates are in the phase skills).

If the `agentq` tools are missing, the server is not registered: tell the user to run `bun run install:mcp` from the AgentQ checkout, then restart the tool. Do not work around it.

## Identity

- **toolName**: name of the invoking tool (e.g. `opencode`, `claude`, `codex`, `kimi`, `junie`)
- **version**: Current tool version from configuration
- **model**: Current model from configuration
- **sessionId**: Current session ID from the invoking tool (do not generate)
- **role**: Specified by user at skill invocation, default: `senior`

## Claim a Task

Call `claim_task`:

```json
{ "toolName": "<toolName>", "version": "<version>", "model": "<model>", "role": "<role>", "sessionId": "<sessionId>",
  "host": "<host, optional>", "projectId": "<only claim from this project, optional>", "context": "<summary>" }
```

**Result (success)**: the full task plus `project` and your `agent` identity. Keep `task.id`: the phase skills need it for the `submit_*` tools.
```json
{ "success": true,
  "task": { "id": "...", "title": "...", "description": "...", "steerDetails": "...", "guardrails": ["..."],
    "acceptanceCriteria": ["..."], "status": "coding", "recommendedBranch": "feat/...", "mergeBranch": "develop",
    "worktreePath": null | "{project}/.agentq/worktrees/{taskId}",
    "history": [{ "pre_status": "ready_for_code", "new_status": "coding", "timestamp": "..." }],
    "conversation": [{ "authorName": "...", "timestamp": "...", "message": "...", "messageType": "review" }], "contexts": ["..."],
    "project": { "id": "...", "displayName": "...", "workingDirectory": "/path/to/project" } },
  "agent": { "id": "opencode@1.0|model", "role": "implementer" } }
```

**Result (no tasks):** `{ "success": false, "reason": "no_tasks_available", "message": "No tasks available for your role." }`

**Errors** come back as `{ "success": false, "error": "..." }` with the tool call marked as an error.

## Protocol

1. **Claim** a task with `claim_task`
2. **Read** the task status from the result
3. **Determine phase** from the status (see Phase Routing) and read that phase skill
4. **Work** on the task according to the phase skill
5. **Submit** with the `submit_*` tool given by the phase skill
6. **Repeat** until no tasks available

If an AgentQ runner started you, the task was **already claimed by the runner**: skip steps 1–2 and 6, do not call `claim_task`, work on the task you were given and submit once.

## Phase Routing

The claim moves the task to its in-progress status; route on the status it was claimed from (the last `history` entry's `pre_status`) or on the in-progress status:

| Claimed from | In progress | Phase | Skill to read next |
|--------------|-------------|-------|--------------------|
| `plan_requested` | `planning` | Planning | `agentq-plan` |
| `plan_changes_requested` | `planning` | Planning | `agentq-plan` |
| `ready_for_code` | `coding` | Coding | `agentq-code` |
| `changes_requested` | `coding` | Coding | `agentq-code` |
| `code_review_requested` | `reviewing` | Reviewing | `agentq-review` |
| `approved` | `merging` | Merging | `agentq-merge` |

After claiming, read the skill for the phase and follow it. Do not read the other phase skills.

## Context Reading

Before working on a task, read `task.description` (functional requirements only — what needs to be accomplished), `task.steerDetails` (technical recommendations, implementation hints, preferred approaches), `task.guardrails` (behavioral constraints, do's and don'ts for agents), `task.acceptanceCriteria` (specific, testable conditions that define completion), `task.conversation[]` (previous discussion) and `task.contexts[]` (additional context).

Agents MUST respect guardrails — they define hard constraints that must not be violated during implementation. If a guardrail conflicts with other requirements, the guardrail takes precedence.

## Autonomy

Agents MUST NOT ask the user for permission or confirmation during task execution — no "should I start working on this task?", no "is this plan correct?" before submitting, no "should I proceed?" / "do you want me to continue?", no asking for approval before implementing changes. The workflow is: claim → work → submit → repeat. The agent decides based on the task description and acceptance criteria. If the task is unclear, use reasonable judgment and submit with notes explaining assumptions. The user reviews the result via AgentQ's review flow, not during execution.

## Guardrails

- **NEVER** use API calls (HTTP/curl/fetch) — use the AgentQ MCP tools only (`claim_task`, `submit_*`)
- **DO NOT** use `list_tasks`, `create_task` or `archive_task` in this loop — agents claim, work on the claimed task and submit
- **DO NOT** manage state or generate session IDs
- **DO NOT** retry indefinitely on empty queue — **STOP** and inform user when no tasks available
- **DO NOT** skip phases or jump to other tasks - follow the status-driven phase and focus only on the claimed task until submitted
- **DO NOT** continue working after submitting - once submitted, stop and wait for next claim
- **DO NOT** ask for user permission or approval - work autonomously and submit

## No Tasks Available

When `claim_task` returns `{ "success": false, "reason": "no_tasks_available" }`: stop immediately, inform the user "No tasks available for your role.", and do NOT retry or loop.
