## Context

The CLI currently has commands for task management (create, list, get, claim, submit-*) but no way to discover registered projects. Agents need to know which projects exist and their IDs to create tasks. Additionally, `--description` is optional on `create`, making it easy to create tasks with empty descriptions — but every task should have a meaningful description.

Separately, there's no skill that teaches agents how to create tasks. The existing `agentq-workflow` skill only covers claiming and executing tasks. A new skill is needed for the task creation workflow.

## Goals / Non-Goals

**Goals:**
- Add `agentq projects` command that lists all projects with ID, display name, and working directory
- Make `--description` required on `agentq create`
- Create `agentq-create-task` skill that teaches agents the end-to-end task creation workflow

**Non-Goals:**
- No changes to the database layer — `getProjects()` already exists
- No changes to the web UI or REST API
- No changes to the existing `agentq-workflow` skill

## Decisions

### Decision 1: `agentq projects` command mirrors `agentq list` pattern

The `projects` command follows the same structure as the existing `list` command: a simple `getProjects()` call from `@agentq/shared`, formatted text output for humans and `--json` for agents.

**Why this approach over alternatives:**
- **Mirroring `list`** keeps the codebase consistent — same imports, same output helpers, same JSON/text dual mode
- A dedicated command is cleaner than forcing agents to parse task output for project info
- No new dependencies or abstractions needed

### Decision 2: `--description` promotion to required

Changing from `.option()` to `.requiredOption()` in Commander.js. The database type (`description: string`) already requires a value — the `|| ""` fallback hid empty input.

### Decision 3: Skill resides in `skills/agentq-create-task/SKILL.md`

Follows the same convention as `skills/agentq-workflow/SKILL.md`. The skill is a standalone instructional document — no code changes to the skill system itself.

### Decision 4: Task elaboration guidelines in the skill

The skill instructs agents to:
- Use `agentq projects --json` for project discovery (matching by workingDirectory or user-provided project name)
- Always enhance descriptions and generate acceptance criteria
- Auto-generate branch names from task titles (kebab-case, prefixed like `feat/` or `fix/`)
- Respect user-provided values for priority and branch when given

## Risks / Trade-offs

- **[Risk] Agents may over-elaborate**: The skill encourages deep descriptions — some tasks may be simple. Mitigation: the skill instructs agents to match elaboration depth to task complexity.
- **[Risk] Project discovery ambiguity**: The skill resolves this by: user-named project > cwd path matching > asking user. Three-tier fallback should cover most cases.
