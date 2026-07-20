## Context

The ATQ project is a monorepo with three packages: `cli`, `shared`, and `web`/`web-ui`. The CLI (`atq`) is the primary interface for agents to claim and submit tasks. Skills (`atq-workflow`) enable AI coding tools to interact with ATQ.

Currently, there's no distribution mechanism. Users must manually:
1. Build the CLI from source
2. Copy the binary to a PATH directory
3. Copy SKILL.md to each tool's skills directory

This change adds a `packages/installer/` that automates both steps.

## Goals / Non-Goals

**Goals:**
- Single-command binary installation (`bun run install:bin`)
- Single-command skill installation (`bun run install:skills`)
- Support all 5 tools: Claude Code, OpenCode, Codex, Kimi Code, Junie
- Idempotent: running twice overwrites cleanly
- Graceful handling when a tool isn't installed

**Non-Goals:**
- Uninstall scripts
- Cross-platform Windows support (assumes Unix-like)
- Auto-update mechanism
- Package manager distribution (brew, npm)

## Decisions

### 1. Binary location: `~/.local/bin/atq`

**Choice**: Install to `~/.local/bin/`

**Alternatives considered**:
- `/usr/local/bin/` — Requires sudo on macOS, not user-writable
- `/usr/bin/` — Requires sudo, conflicts with system files
- Project-local `node_modules/.bin/` — Not globally accessible

**Rationale**: `~/.local/bin/` is user-writable without sudo, follows XDG conventions, and is the standard location for user-installed binaries. The installer prints a warning if this directory is not in PATH.

### 2. Build method: `bun build --compile`

**Choice**: Single binary via `bun build --compile`

**Alternatives considered**:
- `bun build` (JavaScript output) — Requires bun at runtime
- `esbuild` bundling — Still needs Node/bun to execute
- `pkg` / `nexe` — Third-party, less maintained

**Rationale**: `bun build --compile` produces a self-contained binary with no runtime dependencies. The `shared` package (SQLite via `bun:sqlite`) bundles correctly.

### 3. Skill installation: Direct copy (no symlinks)

**Choice**: Copy SKILL.md to each tool's directory

**Alternatives considered**:
- Symlinks to source — Breaks if repo moves
- Shared `~/.agents/skills/` with per-tool symlinks — More complex, not all tools support it

**Rationale**: Copy is simpler and more portable. Skills are small (< 300 lines) and infrequently changed. Users re-run `install:skills` after updates.

### 4. Tool detection: Check directory existence

**Choice**: Skip tools whose skills directory doesn't exist

**Alternatives considered**:
- Create directories for all tools — Might surprise users
- Prompt for each tool — Adds friction

**Rationale**: If a directory doesn't exist, the tool isn't installed. Creating it would be confusing. Report which tools were skipped.

### 5. Overwrite policy: Always overwrite

**Choice**: Overwrite existing skills without prompting

**Rationale**: Idempotent behavior is expected for installers. Users running `install:skills` expect the latest version. Version is embedded in SKILL.md frontmatter.

## Risks / Trade-offs

- [Risk] `~/.local/bin/` may not be in PATH on fresh macOS installs → Mitigation: Installer prints PATH warning with instructions
- [Risk] `bun build --compile` produces large binaries (~50MB) → Mitigation: Acceptable for a CLI tool; compression helps
- [Risk] SKILL.md changes require re-running `install:skills` → Mitigation: Document in README; could add version check later
- [Trade-off] Copy vs symlink — copy means no auto-update from source → Accepted: simplicity wins for v1
