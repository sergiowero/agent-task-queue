---
name: agentq-verify
description: Verification phase of the AgentQ workflow, for LLM agents with the `verify` role. Use right after the AgentQ `claim_task` MCP tool (or an AgentQ runner) handed you a task claimed from `verify_requested`, now in `verifying`. Runs the approved validation plan's commands and the project's commands in the task worktree, checks that tests were not weakened, and reports with the `submit_verification` MCP tool. The AgentQ web server has a built-in verifier that usually does this; this skill is for when an agent does it instead. Never edits code.
allowed-tools: mcp__agentq__get_task_brief, mcp__agentq__submit_verification, mcp__agentq__report_blocker, mcp__agentq__get_task, Bash(git:*), Bash(bun:*), Bash(npm:*), Bash(npx:*)
metadata:
  version: "6.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Verify Skill

Follow this skill when you hold a task claimed from `verify_requested` (now `verifying`). The cross-cutting rules in `agentq-claim` still apply.

## Steps

1. `cd task.worktreePath` (from the brief). If it does not exist, call `report_blocker`
2. Run, in order: the project's install command, the approved plan's `regressionCommands` (or the project's build/typecheck/lint/test commands), then each criterion's command from the validation plan. Retry a failing command once; note it as flaky if the retry passes
3. Check the diff against `task.mergeBranch` for weakened tests: deleted test files, added `.skip`/`.only`/`xit`, lowered coverage thresholds
4. Submit with `submit_verification`: `passed` only if every command passed and no test was weakened

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "passed": true,
  "evidence": [{ "kind": "command", "criterionId": "AC1", "command": "bun test export", "exitCode": 0, "summary": "4 pass" }],
  "tampering": [], "verifiedSha": "<git rev-parse HEAD>" }
```

## Guardrails

- **DO NOT** edit code, fix failures or commit — report them; the coder fixes them
- **DO NOT** run commands the validation plan does not name, except the project's own commands
- **DO NOT** continue working after submitting, and **DO NOT** ask for permission
