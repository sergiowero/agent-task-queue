## Why

Agents need the ability to create well-structured tasks from the CLI. Currently, task creation is possible via `agentq create` but there's no way to discover available projects from the CLI, and no skill that teaches agents how to craft detailed tasks with acceptance criteria, smart branch names, and elaborated descriptions.

This change enables agents to act as task creators — taking a user's brief description and producing a fully-formed, detailed task that other agents can claim and execute.

## What Changes

- Add `agentq projects` CLI command to list all registered projects
- Make `--description` a required flag on `agentq create` (was optional)
- Create `agentq-create-task` skill that teaches agents how to:
  - Discover projects via `agentq projects`
  - Elaborate user requests into detailed descriptions + acceptance criteria
  - Generate smart branch names (with user override support)
  - Create the task via `agentq create` with all elaborated fields

## Capabilities

### New Capabilities
- `agentq-create-task-skill`: Agent skill for creating well-structured tasks from the CLI. Covers project discovery, task elaboration (description, acceptance criteria, branch naming), and task creation workflow.

### Modified Capabilities
- `cli-app`: Add `projects` command requirement for listing projects. Make `--description` a required field on the `create` command.

## Impact

- **packages/cli/src/index.ts**: Add `projects` command, change `--description` from `.option()` to `.requiredOption()`
- **skills/agentq-create-task/SKILL.md**: New skill file
- **.opencode/skills/**: Add reference to the new skill
- **openspec/specs/cli-app/spec.md**: Update for new requirements
