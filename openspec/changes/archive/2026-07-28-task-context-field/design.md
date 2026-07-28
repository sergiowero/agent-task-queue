## Context

The `contexts` field already exists in the `Task` type (`packages/shared/src/types.ts:52`) as `contexts: string[]` and is persisted in SQLite as a JSON text column. However:
- No CLI commands expose `--context` flags
- No web UI displays context entries
- The `agentq-workflow` skill never mentions context
- Only programmatic `updateTask` can set it

Context entries are meant to be short summaries of the agent's current state — what they're working on, what they found, what's blocking them — passed between agents on handoffs.

## Goals / Non-Goals

**Goals:**
- Agents can append context entries when claiming or submitting on a task
- Context entries are displayed in the CLI and web UI
- The `agentq-workflow` skill instructs agents to include context on submissions
- Context is a simple `string[]` — each entry is a short free-text summary with timestamp/author associated via conversation entry reference

**Non-Goals:**
- Structured context (key-value, JSON schema) — just free-text summaries
- Context editing or deletion — append-only
- Cross-task context propagation

## Decisions

### 1. Context stored as `contexts: string[]` on the Task (keep existing model)

The existing field works. Each entry is a free-text string. The array order is chronological (push to append).

**Alternatives considered:**
- Structured context objects `{timestamp, author, text}` — rejected because the conversation already carries timestamp/author; the context array is a lightweight parallel track. The web UI can infer timing by matching context entry index to conversation entry index if needed.
- Separate `contexts` table — overkill for a simple string array on a task-scoped entity.

### 2. CLI: `--context` flag on claim and submit commands

Each of these commands gets an optional `--context "string"` flag:

| Command | Behavior |
|---------|----------|
| `claim` | Appends context to `task.contexts[]` |
| `submit-plan --context "..."` | Appends context alongside conversation entry |
| `submit-code --context "..."` | Appends context alongside conversation entry |
| `submit-review --context "..."` | Appends context alongside conversation entry |
| `submit-merge --context "..."` | Appends context alongside conversation entry |
| `create --context "..."` | Seeds initial context entry |

**Why not a separate `agentq context add` command?** — More commands = more surface. Tacking `--context` onto existing flows keeps the agent workflow concise. A dedicated command can be added later if fine-grained context management is needed.

### 3. CLI output: Context shown in `agentq get` and JSON

- `agentq get <id>` text output: prints context entries as a numbered list
- `agentq list --json`: includes `contexts` array in the JSON (already in the Task type, just needs serialization)
- `printTask` helper updated to include contexts when non-empty

### 4. Web UI: New "Context" tab on task detail page

The task detail page at `/tasks/:id/details` currently has two tabs: **Conversation** and **History**. A third **Context** tab is added.

Context tab display:
- Each context entry rendered as a card with quote styling
- Shows entry index as reference (e.g., `#1`, `#2`)
- If timestamps are needed, match by index to conversation entries (conversation entry N was created at the same time as context entry N, roughly)

### 5. Skill update: `agentq-workflow`

The `agentq-workflow` skill's submission steps will include:
```md
- Include `--context "<short summary of current state, findings, or blockers>"` 
  on every submission so the next agent has context
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Context array grows unbounded if agents submit long contexts on every action | Keep it append-only. If it becomes an issue, add a `--replace-context` flag or a trim command later. The web UI can limit display to latest N. |
| No author attribution on context entries (just `string[]`) | Acceptable for v1 — conversation entries already carry author. Future: upgrade to `{author, text}` objects. |
| Agents forget to pass `--context` | Education through the skill + review process. The field is optional — no hard enforcement in v1. |
