## Context

The current ATQ system has an HTTP claim endpoint (`POST /api/tasks/:id/claim`) that lets any agent claim any specific task. This creates a race condition and doesn't leverage the priority field on tasks. The project.md specifies that the CLI should be the primary interface for agents, and claim should be an automatic selection process based on role and priority.

Current state:
- Claim is HTTP-only via `POST /api/tasks/:id/claim`
- Agents choose which task to claim (no auto-selection)
- Priority field exists but is unused in claim logic
- CLI only has list/get/update/delete — no claim or submit commands

## Goals / Non-Goals

**Goals:**
- Make CLI the exclusive interface for agent claim actions
- Auto-select highest-priority eligible task for the agent's role
- Enforce role-based eligibility: planner, implementer, reviewer, and compound roles
- Maintain single-agent exclusivity per task
- Add submit-plan, submit-code, submit-review, submit-merge CLI commands

**Non-Goals:**
- Changing the task status model or workflow states
- Adding task assignment by users (manual assignment is out of scope)
- Supporting concurrent claim attempts (single-user local tool, not multi-agent coordination)

## Decisions

### Decision 1: CLI-only claim with auto-selection

**Choice**: Remove HTTP claim endpoint entirely. The `atq claim` command accepts agent identity args and the system picks the task.

**Rationale**: Agents shouldn't cherry-pick tasks. The system knows priority and eligibility better than the agent. This eliminates race conditions and ensures fair ordering.

**Alternatives considered**:
- Keep HTTP endpoint but add auto-select mode: rejected because it maintains two paths for the same action
- Allow agents to specify a preferred task ID: rejected because it reintroduces the selection problem

### Decision 2: Role-eligibility mapping

**Choice**: Define static claimable statuses per role:

| Role | Claimable Statuses |
|------|-------------------|
| planner | New, Plan Changes Requested |
| implementer | Ready, Changes Requested, Approved |
| reviewer | Code Review Requested |
| senior | all of the above |
| architect | planner + reviewer (no implementer) |

**Rationale**: Maps directly to which statuses appear in the "Pending" column of the board. Implementer claiming from Approved enables the merge flow (Approved → Merging).

**Alternatives considered**:
- Dynamic eligibility based on task requirements: over-engineered for current needs
- Configurable per-project: adds complexity without clear value

### Decision 3: Compound role priority ordering

**Choice**: For compound roles (senior, architect), try roles in fixed priority order: planner → implementer → reviewer. Within each role, sort by task priority descending.

**Rationale**: Planner tasks are blocking (nothing can proceed without a plan), so they should be picked up first. This ensures the pipeline doesn't starve downstream roles.

**Alternatives considered**:
- Treat all roles equally and just sort by task priority: would let a reviewer grab a high-priority task before a planner grabs a blocking task
- Let agent specify preferred role: adds CLI complexity

### Decision 4: Database query for next claimable task

**Choice**: Single SQL query that:
1. Filters tasks by status IN (claimable statuses for role)
2. Filters by assigned_agent IS NULL (unclaimed)
3. Orders by priority DESC, created_at ASC (tiebreaker)
4. LIMIT 1

**Rationale**: Efficient, atomic, and leverages SQLite's built-in ordering. The `created_at` tiebreaker ensures FIFO for same-priority tasks.

**Alternatives considered**:
- Application-level filtering: slower and more error-prone
- Priority queue data structure: unnecessary complexity for SQLite

### Decision 5: Claim returns task context to CLI

**Choice**: The `atq claim` command outputs the full task details (title, description, acceptance criteria, branch, status) in structured format so the agent has context to begin work.

**Rationale**: Agents need context immediately after claiming. No separate "get task" call needed.

## Risks / Trade-offs

- **Breaking change**: Removing HTTP claim endpoint breaks any external tooling that uses it. Mitigation: the web UI doesn't currently have a claim button, and the CLI is the intended interface.
- **Race condition on claim**: Two CLI agents could try to claim simultaneously. Mitigation: SQLite WAL mode + the claim is a single transaction; in practice this is a local single-user tool, not a distributed system.
- **Priority starvation**: Low-priority tasks may never get claimed if high-priority tasks keep arriving. Mitigation: users can reprioritize tasks in the web UI.

## Migration Plan

1. Deploy new CLI with claim command
2. Remove HTTP claim endpoint from web server
3. Update web UI to remove claim actions (if any exist)
4. No data migration needed — task schema is unchanged
