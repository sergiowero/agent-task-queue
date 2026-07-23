## 1. CLI: Add projects command and make --description required

- [x] 1.1 Add `getProjects` to the import from `@agentq/shared` in `packages/cli/src/index.ts`
- [x] 1.2 Add `agentq projects` command — list projects with formatted output and `--json` support
- [x] 1.3 Change `--description` from `.option()` to `.requiredOption()` on the `create` command
- [x] 1.4 Remove `|| ""` fallback for `options.description` in the create action handler

## 2. Create agentq-create-task skill

- [x] 2.1 Create `skills/agentq-create-task/SKILL.md` with project discovery, task elaboration, and creation workflow instructions
- [x] 2.2 Register the skill in `.opencode/skills/agentq-create-task/` (symlink or copy)
- [x] 2.3 Verify the skill is discoverable and the instructions are complete

## 3. Sync specs to main

- [ ] 3.1 Archive the change to sync delta specs to main specs
