## 1. Package Setup

- [x] 1.1 Create `packages/installer/` directory structure
- [x] 1.2 Create `packages/installer/package.json` with `install:bin` and `install:skills` scripts
- [x] 1.3 Create `packages/installer/tsconfig.json`

## 2. Binary Installer (install:bin)

- [x] 2.1 Create `packages/installer/src/install-bin.ts` that:
  - Runs `bun build --compile` on `packages/cli/src/index.ts`
  - Outputs to a temp binary file
  - Copies binary to `~/.local/bin/atq`
  - Creates `~/.local/bin/` if missing
  - Prints version and installation path
- [x] 2.2 Add `bin` script to root `package.json` pointing to installer

## 3. Skill Installer (install:skills)

- [x] 3.1 Create `packages/installer/src/install-skills.ts` that:
  - Reads `skills/atq-workflow/SKILL.md` as source
  - Defines tool paths map:
    - `claude`: `~/.claude/skills/atq-workflow/SKILL.md`
    - `opencode`: `~/.config/opencode/skills/atq-workflow/SKILL.md`
    - `codex`: `~/.codex/skills/atq-workflow/SKILL.md`
    - `kimi`: `~/.kimi-code/skills/atq-workflow/SKILL.md`
    - `junie`: `~/.junie/skills/atq-workflow/SKILL.md`
  - For each tool: checks if parent directory exists, skips if not
  - Creates `atq-workflow/` subdirectory if missing
  - Copies SKILL.md (overwrites if exists)
  - Prints summary: installed tools + skipped tools
- [x] 3.2 Add `skills` script to root `package.json` pointing to installer

## 4. Root Integration

- [x] 4.1 Add `install:bin` and `install:skills` scripts to root `package.json`
- [x] 4.2 Add `packages/installer/` to workspace list in root `package.json`

## 5. Testing

- [x] 5.1 Test `bun run install:bin` — verify binary exists at `~/.local/bin/atq`
- [x] 5.2 Test `bun run install:skills` — verify skill copied to each tool directory
- [x] 5.3 Test idempotency — run twice, verify no errors
- [x] 5.4 Test with missing tool directory — verify skip behavior
