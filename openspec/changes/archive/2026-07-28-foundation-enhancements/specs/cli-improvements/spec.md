## ADDED Requirements

### Requirement: Required option enforcement
Options that are required for command execution SHALL use Commander's `.requiredOption()` instead of manual validation.

#### Scenario: submit-code worktree is required
- **WHEN** running `agentq submit-code <id>` without `--worktree`
- **THEN** Commander shows a "missing required flag" error before the action runs

### Requirement: JSON error output to stderr
When `--json` mode is active and a command fails, the error output SHALL be written to stderr, not stdout, to preserve valid JSON pipelining.

#### Scenario: JSON error on stderr
- **WHEN** a command with `--json` encounters an error
- **THEN** the error JSON is written to stderr and the process exits with non-zero status

### Requirement: Typed command options
CLI command option interfaces SHALL use proper TypeScript types instead of `any`.

#### Scenario: Options are typed
- **WHEN** defining a CLI command action
- **THEN** the options parameter has a named interface with typed fields

### Requirement: Help text with examples
CLI commands SHALL include usage examples in their help output.

#### Scenario: Command help shows example
- **WHEN** running `agentq create --help`
- **THEN** the output includes an example like `agentq create "My Task" --project my-project -d "Description"`
