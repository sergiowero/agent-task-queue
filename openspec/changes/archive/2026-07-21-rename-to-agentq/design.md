## Context

The project currently uses "ATQ" and "Agent Task Queue" as visual identifiers across the Web UI and documentation. The CLI internally uses `atq` as the command name, package scope, and database identifier. The user wants to rebrand the visual layer to "AgentQ" while preserving all internal `atq` references to avoid breaking changes.

Current state:
- Web UI title: "ATQ - your 100x engineer tool"
- Web UI sidebar heading: "ATQ"
- README heading: "agent-task-queue"
- project.md heading: "Agent Task Queue"
- CLI command, packages, env vars all use `atq`

## Goals / Non-Goals

**Goals:**
- Update visual brand from "ATQ" to "AgentQ" in Web UI and documentation
- Preserve all internal `atq` identifiers (CLI, packages, env vars, DB)

**Non-Goals:**
- Renaming CLI command or packages
- Changing database paths or environment variables
- Modifying API endpoints or internal code references
- Updating AI skill file names or paths

## Decisions

### Decision: Scope of rename to visual-only

**Choice**: Rename only user-facing text (UI title, sidebar, README, project.md)

**Rationale**: Renaming internal identifiers (`@atq/cli`, `atq.db`, `ATQ_DB_PATH`) would require coordinated changes across packages, environment configs, and installer scripts. The risk of breaking existing installations outweighs the benefit of full consistency. Internal `atq` references are not user-visible.

**Alternatives considered**:
- Full rename to `agentq` everywhere: Rejected due to high risk of breaking changes across packages, scripts, and user environments
- Partial internal rename (packages only): Rejected because it adds complexity without user-facing benefit

### Decision: Files to modify

**Choice**: Modify exactly 4 files:
1. `packages/web-ui/index.html` — page title
2. `packages/web-ui/src/components/Layout.tsx` — sidebar heading
3. `README.md` — repository heading
4. `project.md` — project documentation heading and example displayName

**Rationale**: These are the only files where "ATQ" or "Agent Task Queue" appears as a user-visible label. All other occurrences are in internal code, specs, or archived change documents.

## Risks / Trade-offs

- **Risk**: Users familiar with "ATQ" may be confused by the new name → **Mitigation**: The change is purely cosmetic; the tool's functionality is unchanged. The tagline "your 100x engineer tool" remains consistent.
- **Risk**: Documentation references in archived changes still say "ATQ" → **Mitigation**: Archived changes are historical records and should not be modified.
