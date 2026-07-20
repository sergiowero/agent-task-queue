## Why

The agent-task-queue (ATQ) project has two distributable components: a CLI binary (`atq`) and agent skills (`atq-workflow`). Currently, there's no standardized way to install these on a user's machine. Users must manually copy files to the correct locations, which is error-prone and doesn't scale across supported tools (Claude Code, OpenCode, Codex, Kimi Code, Junie).

An installer provides a single-command setup experience: `bun run install:bin` for the CLI and `bun run install:skills` for agent integration.

## What Changes

- Add `packages/installer/` with two install scripts
- `bun run install:bin`: Builds a single binary via `bun build --compile` and installs to `/usr/local/bin/atq`
- `bun run install:skills`: Copies `skills/atq-workflow/SKILL.md` to each tool's global skills directory
- Root `package.json` gains `install:bin` and `install:skills` scripts
- Supported tools: Claude Code, OpenCode, Codex, Kimi Code, Junie

## Capabilities

### New Capabilities

- `installer`: Binary and skill installation scripts for distributing ATQ to developer machines

### Modified Capabilities

- (none)

## Impact

- New package: `packages/installer/`
- Modified: root `package.json` (new scripts)
- Dependencies: `bun` (build tool, already required)
- Target paths: `/usr/local/bin/`, `~/.claude/skills/`, `~/.config/opencode/skills/`, `~/.codex/skills/`, `~/.kimi-code/skills/`, `~/.junie/skills/`
