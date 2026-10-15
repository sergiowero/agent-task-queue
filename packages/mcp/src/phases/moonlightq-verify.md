# MoonlightQ Verify Skill

Follow this skill when you hold a task claimed from `verify_requested` (now `verifying`). The cross-cutting rules in `moonlightq-claim` still apply.

You verify instead of the built-in verifier because the project is set to agent verification (Projects → Edit → Autonomy → Who verifies code: code always waits for an agent with the `verify` role, with or without project commands), or because the built-in verifier is off and a runner with your role took over. You are never handed code you wrote, nor, when the project requires another model, code written on your model.

## Independent Verification

Your **brief** (`brief` in the claim result, or `get_task_brief`) is an independent one (`brief.independent: true`): the task, the criteria with the command that checks each one, the approved plan and its validation plan, and the project's commands. It leaves out, on purpose, the coder's message, handoff notes, evidence and view of which criteria are met. Trust only the output of the commands you run; while you hold the task, `get_task` returns the same brief.

## Steps

1. `cd brief.task.worktreePath`. If it does not exist, call `report_blocker`. If `git status --porcelain` is not empty, or `git rev-parse HEAD` is not `brief.task.headSha` (when set), run nothing: submit `passed: false` with that output as the evidence, so the coder commits the right code
2. Run, in order: the project's commands (`brief.commands`: install, build, typecheck, lint, test; a project that verifies with an agent may have none), then the approved plan's `regressionCommands` (they add to the project's commands, never replace them), then each criterion's command from the validation plan (or `brief.criteria[].verify.command`). Retry a failing command once; note it as flaky if the retry passes. When there is nothing to run at all, check each criterion by reading the code and report it as `manual` evidence: the code goes on to review marked as not verified, never as a pass
3. Check the diff against `brief.task.mergeBranch` for weakened tests: deleted test files or tests moved out of the test folders, added `.skip`/`.only`/`.skipIf`/`xit`/`@pytest.mark.skip`/`xfail`/`#[ignore]`, lowered or removed coverage thresholds. The server reads the same diff itself: tampering it finds makes the verification red even if you report none, and protected paths or a diff over the project's limit raise the task's risk (there is nothing to report for those). Report the tampering you find anyway
4. Submit with `submit_verification`: `passed` only if every command passed and no test was weakened. `evidence` has one entry per command you ran (`kind: "command"`, with `command`, `exitCode`, `summary` and the `criterionId` it checks) and one `kind: "manual"` entry per check done by hand; it is recorded under your own agent id. A pass where no command ran is recorded as not verified

```json
{ "taskId": "<task.id>", "claimToken": "<claimToken>", "passed": true,
  "evidence": [{ "kind": "command", "criterionId": "AC1", "command": "bun test export", "exitCode": 0, "summary": "4 pass" }],
  "tampering": [], "verifiedSha": "<git rev-parse HEAD>",
  "context": "<for the coder: what failed and whether it is the code or the environment>", "next": ["<what to fix first>"] }
```

`context` (with the optional `decisions`, `risks` and `next`) is optional on `submit_verification`, because the built-in verifier sends none, but pass it: the coder reads it next to the failing commands. The reviewer never sees it.

## Guardrails

- **DO NOT** edit code, fix failures or commit — report them; the coder fixes them
- **DO NOT** run commands the validation plan does not name, except the project's own commands
- **DO NOT** look for the coder's context (conversation, handoffs, evidence): run the commands and report what they print
- **DO NOT** continue working after submitting, and **DO NOT** ask for permission
