## Context

ATQ has a CLI (`atq`) that operates directly against a local SQLite database. Coding agents need to interact with this CLI to claim tasks, do work, and submit results. Currently there is no skill or protocol defining how agents should use the CLI. The CLI also outputs human-readable text, not structured JSON suitable for agent consumption.

The system supports 15 task statuses, 5 agent roles (planner, implementer, reviewer, senior, architect), and a workflow where tasks flow through planning → coding → review → merge phases. Agents must understand which phase they're in based on task status and act accordingly.

## Goals / Non-Goals

**Goals:**
- Create an `atq-workflow` skill that teaches agents the complete protocol
- Make CLI output JSON-parseable for agents
- Add `worktreePath` field to Task so code location persists across agents
- Ensure agents never commit/push except during merge phase
- Ensure agents always work in worktrees for coding/review/merge phases
- Include project details (workingDirectory) in claim response

**Non-Goals:**
- Adding a `my-task` or `list` command for agents (agents only use `claim` and `submit-*`)
- Resume mechanisms or session persistence
- Changing the web UI
- Adding new roles or modifying existing workflow transitions

## Decisions

### 1. Skill as single file vs modular skills

**Decision**: Single skill file at `.opencode/skills/atq-workflow/SKILL.md`

**Rationale**: The agent protocol is compact — 5 commands, one status→action mapping, a few guardrails. Splitting into multiple skills adds coordination overhead without benefit. The ohxeng reference showed that a single protocol file works well for this scope.

**Alternatives considered**: Modular skills (atq-core, atq-planner, atq-implementer) — rejected as over-engineered for the current scope.

### 2. JSON output via --json flag vs default JSON

**Decision**: Add `--json` flag to all CLI commands. Default remains human-readable.

**Rationale**: Backward compatible. Humans still get readable output. Agents pass `--json`. No breaking change.

**Alternatives considered**: Default JSON with `--text` for humans — rejected as breaking change.

### 3. Worktree path storage

**Decision**: Add `worktreePath` field to Task. CLI sets it when agent calls `submit-code` with `--worktree` flag.

**Rationale**: The coder creates the worktree and knows its path. Storing it on the task lets reviewers and mergers find the same worktree without creating duplicates. The path is ephemeral (`/tmp/atq-{taskId}`) and cleaned up after merge.

**Alternatives considered**: Store worktree path in agent entity — rejected because multiple agents (coder, reviewer, merger) need access to the same worktree.

### 4. Claim response includes project object

**Decision**: `atq claim` JOINs the project table and returns the full project object (not just projectId).

**Rationale**: Agents need `project.workingDirectory` to know where to create worktrees. Returning the full object avoids a second CLI call.

### 5. Session ID from invoking tool

**Decision**: Skill references the current session ID from the tool (e.g., OpenCode session). Agent does not generate one.

**Rationale**: Session IDs are for user traceability, not agent logic. Generating UUIDs adds complexity with no benefit since agents don't use them for state.

### 6. Role specified at skill trigger

**Decision**: User specifies role when invoking the skill. Default is "senior" (can do everything).

**Rationale**: Role determines what the agent can claim and submit. It must be explicit. Defaulting to senior gives maximum flexibility.

## Risks / Trade-offs

- **[Risk] Agents may still try to call `atq list`** → Mitigation: Strong guardrails in skill. CLI could optionally warn on list usage by agents.
- **[Risk] JSON output may lag behind text output** → Mitigation: Implement both in same command handler, share the same data.
- **[Risk] Worktree path becomes stale if agent crashes** → Mitigation: Orphaned worktrees are cleaned up manually or by future `atq cleanup` command (out of scope).
- **[Trade-off] No resume mechanism** → Agent loses context on restart. Acceptable because tasks are short-lived and the claim command returns full context.
