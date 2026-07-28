# Config Tooling

Development tooling configuration including ESLint, Prettier, TypeScript, Vite, and Git settings.

## Requirements

### Requirement: ESLint configuration
The project SHALL have an ESLint flat config at the root with TypeScript, React, and import plugins.

#### Scenario: ESLint passes
- **WHEN** running `bun run lint`
- **THEN** the command exits with code 0 if no errors exist

#### Scenario: ESLint catches TypeScript errors
- **WHEN** a file has unused imports or type mismatches
- **THEN** ESLint reports the error and exits with non-zero code

### Requirement: Prettier formatting
The project SHALL have a Prettier config at the root with consistent formatting rules for TS, TSX, JSON, CSS, and Markdown files.

#### Scenario: Code is formatted
- **WHEN** running `bun run format`
- **THEN** all source files are reformatted according to Prettier rules

### Requirement: Root tsconfig
The project SHALL have a root `tsconfig.json` with shared compiler options that all packages extend.

#### Scenario: All packages compile
- **WHEN** running `tsc -b` at the root
- **THEN** all packages compile without errors and the installer tsconfig extends the root correctly

### Requirement: Package.json standards
The root `package.json` SHALL include `"type": "module"` and `"packageManager"` fields.

#### Scenario: Package manager is pinned
- **WHEN** running `bun install`
- **THEN** the lockfile is compatible with the pinned Bun version

### Requirement: .gitattributes
The project SHALL have a `.gitattributes` file enforcing LF line endings for all source files.

#### Scenario: Consistent line endings
- **WHEN** files are checked out
- **THEN** `.ts`, `.tsx`, `.json`, `.css`, `.md` files use LF line endings

### Requirement: .gitignore cleanup
The `.gitignore` SHALL NOT ignore the `.github/` directory and SHALL track `*.tsbuildinfo` for incremental builds.

#### Scenario: GitHub actions are tracked
- **WHEN** running `git status`
- **THEN** `.github/` files appear in tracked changes

### Requirement: Vite production build optimization
The Vite config SHALL include manual chunk splitting for vendor dependencies and production compression.

#### Scenario: Production build splits chunks
- **WHEN** running `bun run build`
- **THEN** the output includes separate vendor chunk and application chunk
