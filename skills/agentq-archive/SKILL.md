---
name: agentq-archive
description: Archives finished AgentQ tasks into their project's repository, the same as the board's "Archive" button. Use when the user asks to archive a task, archive the complete/completed/done tasks, clean up the Done column, or save a task's history (description, conversation, PR, branch, agents) as Markdown. For each task, `agentq archive <taskId>` writes `archive/<name>.summary.md` and `archive/<name>.detailed.md` in the project and takes the task off the board. The skill also finds the pull request with `gh` when the conversation does not mention it, and writes an overview of what was done.
allowed-tools: Bash(agentq:*), Bash(gh:*), Bash(git:*)
metadata:
  version: "1.0.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Archive Skill

Archive saves a finished task in its project repository as two Markdown files, then takes the task off the board. The board's **Archive** button on complete cards runs the same code. This skill can also do two things the button can't: find the pull request with `gh`, and write an overview of what was done.

| Aspect | Details |
|---|---|
| **Which tasks** | Only tasks in `complete` status that are not archived yet |
| **Where** | `{task.project.workingDirectory}/archive/` (the folder is created if missing) |
| **Summary file** | `<YYYY-MM-DD>-<id8>-<title-slug>.summary.md`: key facts (project, branch, merge target, PR, commit, authors, agents, iterations, dates), your overview, the description, the acceptance criteria, what was done (the latest plan, implementation, review and merge messages), the agent sessions and the status path |
| **Detailed file** | `<same name>.detailed.md`: every field of the task, the steer details, guardrails and context notes, each agent (tool, version, model, role, session, host) and each claim with its outcome, the full status history, **every** conversation message, the activity log and the raw task JSON |
| **Effect** | The task gets `archivedAt` / `archivePath`, a "Task archived" system message and a `task_archived` activity event. It leaves the board and `agentq list`, and `agentq get` still returns it |

## CLI Commands

```bash
agentq projects --json                                             # id, displayName, workingDirectory
agentq list --status complete [--project <projectId>] --json       # tasks waiting to be archived (archived ones are left out)
agentq get <taskId> --json                                         # full task: description, conversation, history, contexts, project
agentq archive <taskId> --json [--pr <url>]... [--summary "<markdown>"] [--force] [--dir <path>]
```

**`agentq archive` response:**
```json
{ "success": true, "taskId": "...", "archivedAt": "2026-09-22T10:00:00.000Z",
  "directory": "/path/to/project/archive",
  "summaryPath": "/path/to/project/archive/2026-09-22-1a2b3c4d-add-dark-mode.summary.md",
  "detailedPath": "/path/to/project/archive/2026-09-22-1a2b3c4d-add-dark-mode.detailed.md",
  "pullRequests": ["https://github.com/org/repo/pull/42"] }
```

On failure: `{ "success": false, "error": "..." }` on stderr and a non-zero exit code.

| Flag | What to pass |
|------|--------------|
| `--pr <url>` | A pull request URL (or ref such as `#42`) to record. Repeat it for several. PR URLs already in the conversation are found automatically. |
| `--summary "<markdown>"` | Your overview of what was done, placed at the top of the summary file |
| `--force` | Only when the user explicitly asks to re-archive (regenerate) a task that is already archived. It rewrites the same files. |
| `--dir <path>` | Only when the user asks for a different folder than `{project}/archive` |

## Protocol

### 1. Pick the tasks

| The user asked for | Tasks |
|--------------------|-------|
| Specific task ids | Those ids |
| "Archive the complete tasks" / "clean up the Done column" | `agentq list --status complete --json` |
| The same, for one project | Match the project in `agentq projects --json` (by name, or by the repo the user is in), then `agentq list --status complete --project <id> --json` |

- If there is nothing to archive, tell the user "No complete tasks to archive." and stop.
- A task in `merged` status is not complete yet: the user confirms completion first (the **Confirm complete** button on the task page). Report it and skip it. Do not change its status.

### 2. Read each task

```bash
agentq get <taskId> --json
```

Read `description`, `acceptanceCriteria`, `conversation[]` (the `plan`, `code`, `review` and `merge` messages and the user's change requests), `history[]`, `contexts[]` and `project.workingDirectory`.

### 3. Find the pull request

- If a conversation message (usually the `merge` one) already has a PR URL (`…/pull/<n>`), do nothing. The archive picks it up.
- Otherwise, ask GitHub from the project directory:

```bash
cd {task.project.workingDirectory}
gh pr list --head {task.recommendedBranch} --state all --json number,url,title,state --limit 5
```

  Pass each matching URL with `--pr`. If `gh` is missing, not signed in, or finds nothing, archive without a PR. Never block on this step.

### 4. Write the overview

Write 3–8 Markdown bullets (under 200 words) for `--summary`:

- What was built or changed, in plain words
- Key decisions or approaches, from the plan and the code submission
- How review went: rounds, change requests and what they asked for
- The outcome: the PR and its merge target
- Follow-ups or known gaps the agents noted, if any

Use only facts from the task. Do not invent anything. If the task has no submissions, say that in one bullet.

### 5. Archive

Pass the overview with a quoted heredoc, so newlines, backticks and `$` survive:

```bash
agentq archive <taskId> --json \
  --pr https://github.com/org/repo/pull/42 \
  --summary "$(cat <<'MD'
- Added a theme toggle to the header that persists the choice in localStorage.
- Plan approved on the first round; one code change request (contrast in dark mode).
- PR #42 into `develop`.
MD
)"
```

### 6. Report

Tell the user, for each task: the title, the summary path, the detailed path and the PR (or "no PR found"), plus any task you skipped and why. Mention that the files are in the working tree and are not committed.

## Errors

| Error | What to do |
|-------|------------|
| `Only complete tasks can be archived; this one is …` | Skip it. For `merged`, tell the user to confirm completion first. |
| `Task is already archived (…)` | Skip it. Re-run with `--force` only if the user asked to regenerate it. |
| `Project working directory not found: …` | Report it. Use `--dir` only if the user gives a folder. |
| `Task has no project, …` | Report it. Use `--dir` only if the user gives a folder. |
| `Task not found.` | Report the id. |

## Git

`agentq archive` only writes files. It does not stage, commit or push. Leave the files uncommitted unless the user asks. If they ask you to commit, stage **only** the new `archive/` files (`git add archive/<name>.summary.md archive/<name>.detailed.md`) and commit them on the current branch. Never include other changes, and never push unless asked.

## Guardrails

- **NEVER** use the HTTP API (curl/fetch). Use the `agentq` CLI, and use `gh` only to read PRs (`gh pr list`, `gh pr view`).
- **DO NOT** change a task's status: no `agentq claim`, no `agentq submit-*`, no confirming completion for the user.
- **DO NOT** use `--force` unless the user explicitly asked to re-archive.
- **DO NOT** hand-edit or delete archive files. To refresh them, re-archive with `--force` (when asked).
- **DO NOT** invent facts in the overview. Everything must come from the task.
- **DO NOT** commit or push the archive files unless the user asks.
- **DO** archive every requested task in one pass without asking for confirmation on each, and report the results at the end.
