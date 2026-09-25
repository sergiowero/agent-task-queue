---
name: agentq-refine
description: Refinement phase of the AgentQ workflow. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `draft`, now in `refining` (the agentq-claim router sends you here). Turns a rough draft into a ready task — clear description, testable acceptance criteria with how each is verified, type, risk, non-goals, whether it needs a plan — and submits it with the `submit_refinement` MCP tool. Never writes code.
allowed-tools: mcp__agentq__get_task_brief, mcp__agentq__submit_refinement, mcp__agentq__report_blocker, mcp__agentq__get_task, mcp__agentq__post_comment, Bash(git:*)
metadata:
  version: "6.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Refine Skill

Follow this skill when you hold a task claimed from `draft` (now `refining`). The cross-cutting rules in `agentq-claim` still apply. Read the draft through its **brief**; `task.dorIssues` lists what makes it not ready yet.

## Steps

1. Read the draft and look at the relevant code read-only in `task.project.workingDirectory`, so the criteria are grounded
2. Rewrite the description if needed: what and why, functional only (the how goes in steerDetails)
3. Write 3–5 **testable** acceptance criteria. When a command can prove one, write it as `"text $ command"` — the verifier runs it
4. Set `type` (feature, bug, refactor, docs, chore) and `risk` (low, medium, high; migrations, auth, CI and public APIs are high); list `nonGoals` when the scope could be misread
5. Set `requiresPlan: true` for multi-step or high-risk work
6. If only a person can answer something (a product decision, missing access), add it to `openQuestions` with `blocking: true`: the task goes to that person instead of moving on
7. Submit with `submit_refinement`

## Submit Refinement

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>",
  "description": "<refined description>",
  "acceptanceCriteria": ["Export includes a header row $ bun test export", "Empty accounts export an empty file"],
  "type": "feature", "risk": "medium", "nonGoals": ["PDF export"], "requiresPlan": false,
  "openQuestions": [{ "text": "Should archived rows be included?", "blocking": false }],
  "message": "<markdown: what you changed and why>", "context": "<assumptions for the planner or coder>" }
```

## Guardrails

- **DO NOT** write code, create worktrees or commit
- **DO NOT** invent requirements: when the draft does not say, ask with a blocking open question
- **DO NOT** continue working after submitting, and **DO NOT** ask for permission
