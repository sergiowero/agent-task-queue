## 1. CLI: Make worktree mandatory

- [x] 1.1 Add validation in `submit-code` command to require `--worktree` flag
- [x] 1.2 Return clear error message when `--worktree` is missing

## 2. Web UI: Display worktree path

- [x] 2.1 Add `Field` for worktree path in `TaskDrawer.tsx` summary tab

## 3. Skill: Enforce worktree creation

- [x] 3.1 Update worktree rules to mandate `.atq/worktrees/{taskId}` path inside project
- [x] 3.2 Add guardrail: agents must create worktree before coding phase
- [x] 3.3 Add guardrail: agents must use existing worktree if already assigned

## 4. Skill: Enforce single-task focus

- [x] 4.1 Add guardrail: agents must not jump to other tasks after submission
- [x] 4.2 Add guardrail: agents must not use `atq list` or `atq get`

## 5. Skill: Enforce autonomous execution

- [x] 5.1 Add guardrail: agents must not ask for permission during execution
- [x] 5.2 Add guardrail: agents must use reasonable judgment when unclear
