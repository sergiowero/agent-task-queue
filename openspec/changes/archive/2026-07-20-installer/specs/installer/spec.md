## ADDED Requirements

### Requirement: Binary installation via install:bin script

The system SHALL provide a `bun run install:bin` script that builds and installs the `atq` CLI binary to `~/.local/bin/atq`.

#### Scenario: Successful binary installation

- **WHEN** user runs `bun run install:bin`
- **THEN** the CLI is compiled from `packages/cli/src/index.ts` into a single binary
- **AND** the binary is copied to `~/.local/bin/atq`
- **AND** `~/.local/bin/atq --version` returns the current version

#### Scenario: Directory creation when missing

- **WHEN** `~/.local/bin/` does not exist
- **AND** user runs `bun run install:bin`
- **THEN** the directory is created before copying the binary

#### Scenario: Existing binary overwritten

- **WHEN** `~/.local/bin/atq` already exists
- **AND** user runs `bun run install:bin`
- **THEN** the existing binary is overwritten without prompting

#### Scenario: PATH warning

- **WHEN** `~/.local/bin/` is not in the user's PATH
- **AND** user runs `bun run install:bin`
- **THEN** the script prints a warning with instructions to add it to PATH

### Requirement: Skill installation via install:skills script

The system SHALL provide a `bun run install:skills` script that copies `skills/atq-workflow/SKILL.md` to each supported tool's global skills directory.

#### Scenario: Installation to all supported tools

- **WHEN** user runs `bun run install:skills`
- **THEN** the script copies SKILL.md to each of the following paths if the parent directory exists:
  - `~/.claude/skills/atq-workflow/SKILL.md`
  - `~/.config/opencode/skills/atq-workflow/SKILL.md`
  - `~/.codex/skills/atq-workflow/SKILL.md`
  - `~/.kimi-code/skills/atq-workflow/SKILL.md`
  - `~/.junie/skills/atq-workflow/SKILL.md`

#### Scenario: Skip tools not installed

- **WHEN** user runs `bun run install:skills`
- **AND** `~/.claude/skills/` does not exist
- **THEN** the script skips Claude Code installation
- **AND** reports which tools were skipped

#### Scenario: Create skill directory if missing

- **WHEN** `~/.claude/skills/` exists but `~/.claude/skills/atq-workflow/` does not
- **AND** user runs `bun run install:skills`
- **THEN** the `atq-workflow/` directory is created before copying SKILL.md

#### Scenario: Overwrite existing skill

- **WHEN** `~/.claude/skills/atq-workflow/SKILL.md` already exists
- **AND** user runs `bun run install:skills`
- **THEN** the existing file is overwritten without prompting

### Requirement: Root package.json integration

The root `package.json` SHALL include `install:bin` and `install:skills` scripts.

#### Scenario: Scripts are accessible from project root

- **WHEN** user runs `bun run install:bin` from the project root
- **THEN** the binary installation executes

- **WHEN** user runs `bun run install:skills` from the project root
- **THEN** the skill installation executes

### Requirement: Installation report

The installer SHALL output a summary of actions taken.

#### Scenario: Successful installation report

- **WHEN** user runs `bun run install:skills`
- **THEN** the script prints a list of tools where the skill was installed
- **AND** prints a list of tools that were skipped (not installed)

#### Scenario: Binary installation confirmation

- **WHEN** user runs `bun run install:bin`
- **THEN** the script prints the installation path and version
