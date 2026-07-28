## 1. CLI: Add `--context` to `agentq create`

- [x] 1.1 Add `--context <text>` option to `create` command definition in `packages/cli/src/index.ts`
- [x] 1.2 Pass context value to `createTask()` — merge it into the `contexts` array if provided

## 2. CLI: Add `--context` to `agentq claim`

- [x] 2.1 Add `--context <text>` option to `claim` command definition in `packages/cli/src/index.ts`
- [x] 2.2 After claiming, if `--context` was provided, append the string to `task.contexts` via `updateTask`

## 3. CLI: Add `--context` to submit commands

- [x] 3.1 Add `--context <text>` option to `submit-plan` command definition
- [x] 3.2 Add `--context <text>` option to `submit-code` command definition
- [x] 3.3 Add `--context <text>` option to `submit-review` command definition
- [x] 3.4 Add `--context <text>` option to `submit-merge` command definition
- [x] 3.5 In each submit command handler, if `--context` was provided, append it to `task.contexts` via `updateTask`

## 4. CLI: Display context entries in output

- [x] 4.1 Update `printTask` helper in `packages/cli/src/index.ts` to show context entries as numbered list when non-empty
- [x] 4.2 Verify JSON output (`--json`) already includes `contexts` from the shared Task type — ensure it serializes

## 5. Web UI: Context tab on task detail page

- [x] 5.1 Add "Context" as a third tab alongside "Conversation" and "History" in the task detail page component
- [x] 5.2 Create Context tab content component that renders `contexts` array as cards with entry index badges
- [x] 5.3 Handle empty state: show "No context entries recorded" when array is empty
- [x] 5.4 Style context entry cards with blue left border and `#N` badge

## 6. Skill: Update `agentq-workflow` to include context

- [x] 6.1 Update `skills/agentq-workflow/SKILL.md` to instruct agents to include `--context` on every `atq submit-*` and `atq claim`
- [x] 6.2 Update `skills/agentq-create-task/SKILL.md` to include `--context` flag usage in create task instructions
