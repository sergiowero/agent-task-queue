# MoonlightQ Refine Skill

Follow this skill when you hold a task claimed from `draft` (now `refining`). The cross-cutting rules in `moonlightq-claim` still apply. Read the draft through its **brief**; `brief.task.dorIssues` lists what makes it not ready yet.

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
  "message": "<markdown: what you changed and why>", "context": "<assumptions for the planner or coder>",
  "decisions": ["<what you decided, and why>"], "risks": ["<what is still uncertain>"], "next": ["<what the planner or coder should check first>"] }
```

## Guardrails

- **DO NOT** write code, create worktrees or commit
- **DO NOT** invent requirements: when the draft does not say, ask with a blocking open question
- **DO NOT** continue working after submitting, and **DO NOT** ask for permission
