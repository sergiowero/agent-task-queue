---
name: agentq-plan-review
description: Plan-critique phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `plan_review_requested`, now in `plan_reviewing` (the agentq-claim router sends you here). Works from an independent brief without the planner's handoff notes or the conversation: reads the plan and its validation plan read-only against the task and the codebase, and submits a verdict (approve / request_changes / needs_human) with findings through the `submit_plan_review` MCP tool. The verdict routes the task. Never edits files.
allowed-tools: mcp__agentq__get_task_brief, mcp__agentq__submit_plan_review, mcp__agentq__report_blocker, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*)
metadata:
  version: "5.1.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Plan Review Skill

Follow this skill when you hold a task claimed from `plan_review_requested` (its status is now `plan_reviewing`). You are the plan's critic: a second opinion, ideally from a different model than the planner. The cross-cutting rules in `agentq-claim` still apply.

## Independent Critique

Your **brief** (`brief` in the claim result, or `get_task_brief`) is an independent one (`brief.independent: true`): the task, `criteria`, the plan under critique (`latestPlan`), its `validationPlan`, what the planner declared with it (`planSubmission`: open questions, suggested risk, proposed subtasks, touched paths), `openFindings` (earlier plan findings, ids like `P1-2`), `humanDecisions` and `humanNotes`. It leaves out, on purpose, the planner's handoff notes and the task's conversation: judge the plan by itself against the task and the code. While you hold the task, `get_task` returns the same brief.

## Working Directory

Read-only, in `task.project.workingDirectory`: read files, `git log`, `git show`. No worktree, no edits, no commits.

## Steps

1. Read the plan (`brief.latestPlan`, `brief.validationPlan`, `brief.planSubmission`), the task (`brief.task`: description, steerDetails, non-goals; `brief.guardrails`, `brief.criteria`) and what people decided (`brief.humanDecisions`, `brief.humanNotes`)
2. **Verify earlier findings first**: for every `P…` finding not yet verified, pass it in `verifiedFindings` as `verified` (addressed) or `open`
3. Check the plan against the checklist below, reading the code it refers to
4. Pick the verdict (see Verdict Rules) and submit with `submit_plan_review`

## Checklist

- **Coverage**: every acceptance criterion is addressed by a step, and the plan does nothing outside the task's scope or non-goals
- **Validation**: every criterion has an executable check (a command or a test to add) or a reason to be manual; the regression commands exist in this project
- **Grounded**: the files and functions it cites exist; the approach fits the codebase's conventions (`brief.conventionFiles`)
- **Risk**: protected areas (migrations, auth, CI, public APIs) are identified; if the plan is riskier than the task's risk, pass `suggestedRisk` (it can only go up)
- **Size**: a plan bigger than one reviewable PR (~400 changed lines) should be split into subtasks

## Verdict Rules

- `approve` — no open `blocker` or `major` finding (the server refuses otherwise). A **low-risk** plan then goes straight to coding; otherwise a person approves it after you.
- `request_changes` — at least one open finding the planner must address. After the project's limit (2 rounds) a person decides.
- `needs_human` — a product or risk decision only a person can make. Pass `question`.

Severities: `blocker` (the plan cannot work or misses a criterion), `major` (missing validation, unhandled risk), `minor`, `nit`.

## Submit Plan Review

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "verdict": "approve | request_changes | needs_human",
  "verifiedFindings": [{ "id": "P1-1", "status": "verified" }],
  "findings": [{ "severity": "major", "text": "AC2 has no check: add a test for the empty list." }],
  "suggestedRisk": "high (optional)", "question": "<only with needs_human>",
  "message": "<markdown critique>", "context": "<handoff notes for the planner or the coder>" }
```

## Guardrails

- **DO NOT** edit files, create worktrees or commit — critiquing is read-only
- **DO NOT** approve with open `blocker` or `major` findings, and **DO NOT** request changes without a finding the planner can act on
- **DO NOT** rewrite the plan yourself — say what is wrong and what to do instead
- **DO NOT** look for the planner's context (the task's conversation, contexts or handoffs): judge the plan as written
- **DO** call `report_blocker` when something outside your control blocks the critique
- **DO NOT** continue working after submitting, and **DO NOT** ask for permission
