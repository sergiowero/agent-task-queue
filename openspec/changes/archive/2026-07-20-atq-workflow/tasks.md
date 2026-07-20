## 1. Database Schema

- [x] 1.1 Add `worktree_path` column to tasks table in `packages/shared/src/database.ts` (TEXT, nullable, default null)
- [x] 1.2 Update `rowToTask` to map `worktree_path` to `worktreePath`
- [x] 1.3 Update `createTask` to include `worktreePath` in INSERT
- [x] 1.4 Update `updateTask` to accept and persist `worktreePath`

## 2. Shared Types

- [x] 2.1 Add `worktreePath: string | null` field to `Task` interface in `packages/shared/src/types.ts`

## 3. CLI JSON Output

- [x] 3.1 Add `--json` flag to all CLI commands using commander's `.option('--json')`
- [x] 3.2 Create JSON output helper that wraps response in `{ success: true, ... }` or `{ success: false, error: "..." }`
- [x] 3.3 Update `atq claim` to return JSON with `task` (including embedded `project` object) and `agent` fields when `--json` is specified
- [x] 3.4 Update `atq submit-plan` to return JSON with `success`, `taskId`, `previousStatus`, `newStatus`, `message` when `--json` is specified
- [x] 3.5 Update `atq submit-code` to accept `--worktree <path>` flag and store path on task's `worktreePath` field, return structured JSON
- [x] 3.6 Update `atq submit-review` to return structured JSON confirmation
- [x] 3.7 Update `atq submit-merge` to return structured JSON confirmation
- [x] 3.8 Ensure all error responses return `{ "success": false, "error": "..." }` when `--json` is specified

## 4. Claim Command Enhancement

- [x] 4.1 Update `atq claim` to JOIN projects table and return full project object (id, name, displayName, workingDirectory) in task response
- [x] 4.2 Ensure claim returns `agent` object with canonical `id` and effective `role`

## 5. Skill File

- [x] 5.1 Create `.opencode/skills/atq-workflow/` directory
- [x] 5.2 Create `.opencode/skills/atq-workflow/SKILL.md` with front matter (name: atq-workflow, description, metadata)
- [x] 5.3 Write Identity section: toolName "opencode", version/model from config, sessionId from current tool session, role from user with default "senior"
- [x] 5.4 Write CLI Commands section: only `atq claim` and `atq submit-*` with `--json` flag, examples
- [x] 5.5 Write Protocol section: claim → read status → determine phase → work → submit loop
- [x] 5.6 Write Phase Intelligence section: status-to-action mapping (planning→plan, coding→implement, reviewing→review, merging→merge)
- [x] 5.7 Write Worktree section: create worktree only for coding/changes_requested/reviewing/merging, skip for planning, creation command, use existing when worktreePath is set
- [x] 5.8 Write Git Safety section: no git add/commit/push except during merge phase
- [x] 5.9 Write Message Format section: all -m messages in Markdown, templates for each submission type
- [x] 5.10 Write Context Reading section: read task.description, acceptanceCriteria, conversation[], contexts[] before working
- [x] 5.11 Write Guardrails section: no atq list, no atq get, no state management, no session ID generation
- [x] 5.12 Write "no tasks available" handling: stop and inform user

## 6. Documentation

- [x] 6.1 Update `project.md` to document the `worktreePath` field and agent workflow section
