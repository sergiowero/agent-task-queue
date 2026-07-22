## Context

The ATQ system has a `worktreePath` field on tasks, but it's optional in the CLI and not displayed in the UI. Agents can submit code without creating a worktree, risking direct modifications to the main branch. The skill file needs stronger guardrails to enforce single-task focus and autonomous execution.

## Goals / Non-Goals

**Goals:**
- Make worktree mandatory for code submissions
- Standardize worktree path to `.atq/worktrees/{taskId}` inside the project
- Display worktree path in task details UI
- Add skill guardrails for single-task focus and autonomous execution
- Remove `atq list` references from skill

**Non-Goals:**
- Automatic worktree cleanup
- Remote worktree support
- Worktree validation (checking if path actually exists)

## Decisions

### 1. Worktree path format: `.atq/worktrees/{taskId}`

**Decision**: Store worktrees at `{project}/.atq/worktrees/{taskId}`.

**Why**: Keeps worktrees inside the project directory, makes them discoverable, and avoids polluting `/tmp`. The `.atq` directory can be added to `.gitignore`.

**Alternatives considered**:
- `/tmp/atq-{taskId}`: Current approach, but loses worktrees on reboot and pollutes tmp
- `~/.atq/worktrees/{taskId}`: Global, but harder to associate with projects

### 2. CLI enforcement: Validate `--worktree` in submit-code

**Decision**: Make `--worktree` a required option in the `submit-code` command.

**Why**: Fails fast at CLI level rather than storing null and breaking downstream. Clear error message tells agents exactly what's wrong.

### 3. Skill guardrails: Explicit phase restrictions

**Decision**: Add explicit "DO NOT" rules for each phase to prevent agents from jumping ahead.

**Why**: Current skill says "determine phase based on status" but doesn't explicitly forbid cross-phase work. Explicit rules reduce ambiguity.

## Risks / Trade-offs

- **[Risk] Existing tasks without worktrees** → New submissions require it; old tasks with null path remain as-is
- **[Risk] Agents may not know project path** → Claim response includes `project.workingDirectory` — agents use this to construct worktree path
