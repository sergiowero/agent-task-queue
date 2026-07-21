## Why

The project currently uses "ATQ" and "Agent Task Queue" interchangeably across the UI and documentation. The name "AgentQ" is shorter, more memorable, and better suited for a product brand. This change updates the visual identity (Web UI, repository title, documentation) to "AgentQ" while preserving all internal CLI identifiers, package names, and environment variables as `atq` to avoid breaking changes.

## What Changes

- Web UI page title changes from "ATQ - your 100x engineer tool" to "AgentQ - your 100x engineer tool"
- Web UI sidebar heading changes from "ATQ" to "AgentQ"
- Repository README heading changes from "agent-task-queue" to "AgentQ"
- project.md heading and example displayName change to "AgentQ"
- No changes to CLI commands, package names, database paths, environment variables, or any internal code references

## Capabilities

### New Capabilities

None — this is a rename, not a new feature.

### Modified Capabilities

- `web-portal`: Visual branding updates only (title, sidebar heading)
- `project-management`: Example displayName in documentation updated

## Impact

- **Files affected**: `packages/web-ui/index.html`, `packages/web-ui/src/components/Layout.tsx`, `README.md`, `project.md`
- **No breaking changes**: Internal `atq` identifiers remain unchanged
- **No API changes**: REST endpoints, CLI commands, and database schema unaffected
- **No dependency changes**: No new packages or version bumps required
