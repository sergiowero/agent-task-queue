---
name: agentq-archive
description: Archives finished AgentQ tasks into their project's repository, the same as the board's "Archive" button. Use when the user asks to archive a task, archive the complete/completed/done tasks, clean up the Done column, or save a task's history (description, conversation, PR, branch, agents) as Markdown. For each task, the `archive_task` MCP tool writes `archive/<name>.summary.md` and `archive/<name>.detailed.md` in the project and takes the task off the board. The skill also finds the pull request with `gh` when the conversation does not mention it, and writes an overview of what was done.
allowed-tools: mcp__agentq__list_projects, mcp__agentq__list_tasks, mcp__agentq__get_task, mcp__agentq__archive_task, Bash(gh:*), Bash(git:*)
metadata:
  version: "4.1.0"
  author: "Sergo Sanchez<sergioj.sanchezr@gmail.com>"
---

# AgentQ Archive Skill

Archive saves a finished task in its project repository as two Markdown files, then takes the task off the board. The board's **Archive** button on complete cards runs the same code. This skill can also do two things the button can't: find the pull request with `gh`, and write an overview of what was done.

All queue work goes through the tools of the `agentq` MCP server. Your client prefixes their names (in Claude Code `archive_task` is `mcp__agentq__archive_task`). If the `agentq` tools are missing, tell the user to run `bun run install:mcp` from the AgentQ checkout and restart the tool.

| Aspect | Details |
|---|---|
| **Which tasks** | Only tasks in `complete` status that are not archived yet |
| **Where** | `{task.project.workingDirectory}/archive/` (the folder is created if missing) |
| **Summary file** | `<YYYY-MM-DD>-<id8>-<title-slug>.summary.md`: key facts (project, branch, merge target, PR, commit, authors, agents, iterations, dates), your overview, the description, the acceptance criteria, what was done (the latest plan, implementation, review and merge messages), the agent sessions and the status path |
| **Detailed file** | `<same name>.detailed.md`: every field of the task, the steer details, guardrails and context notes, each agent (tool, version, model, role, session, host) and each claim with its outcome, the full status history, **every** conversation message, the activity log and the raw task JSON |
| **Effect** | The task gets `archivedAt` / `archivePath`, a "Task archived" system message and a `task_archived` activity event. It leaves the board and `list_tasks`, and `get_task` still returns it |

## MCP Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `list_projects` | none | `projects[]` with `id`, `displayName`, `workingDirectory` |
| `list_tasks` | `status` (`"complete"` here), `projectId` (optional) | `tasks[]` waiting to be archived (archived ones are left out), each with its `project` |
| `get_task` | `taskId` | The full task: description, conversation, history, contexts, project |
| `archive_task` | `taskId`, `pullRequests[]`, `overview`, `force`, `directory` (all but `taskId` optional) | See below |

**`archive_task` result:**
```json
{ "success": true, "taskId": "...", "archivedAt": "2026-09-22T10:00:00.000Z",
  "directory": "/path/to/project/archive",
  "summaryPath": "/path/to/project/archive/2026-09-22-1a2b3c4d-add-dark-mode.summary.md",
  "detailedPath": "/path/to/project/archive/2026-09-22-1a2b3c4d-add-dark-mode.detailed.md",
  "pullRequests": ["https://github.com/org/repo/pull/42"] }
```

On failure: `{ "success": false, "error": "..." }`, with the tool call marked as an error.

| Argument | What to pass |
|----------|--------------|
| `pullRequests` | Pull request URLs (or refs such as `#42`) to record. PR URLs already in the conversation are found automatically. |
| `overview` | Your overview of what was done, placed at the top of the summary file (Markdown) |
| `force` | `true` only when the user explicitly asks to re-archive (regenerate) a task that is already archived. It rewrites the same files. |
| `directory` | Only when the user asks for a different folder than `{project}/archive` |

## Protocol

### 1. Pick the tasks

| The user asked for | Tasks |
|--------------------|-------|
| Specific task ids | Those ids |
| "Archive the complete tasks" / "clean up the Done column" | `list_tasks` with `{ "status": "complete" }` |
| The same, for one project | Match the project in `list_projects` (by name, or by the repo the user is in), then `list_tasks` with `{ "status": "complete", "projectId": "<id>" }` |

- If there is nothing to archive, tell the user "No complete tasks to archive." and stop.
- A task in `merged` status is not complete yet: the user confirms completion first (the **Confirm complete** button on the task page). Report it and skip it. Do not change its status.

### 2. Read each task

Call `get_task` with `{ "taskId": "<taskId>" }`. Read `description`, `acceptanceCriteria`, `conversation[]` (the `plan`, `code`, `review` and `merge` messages and the user's change requests), `history[]`, `contexts[]` and `project.workingDirectory`.

### 3. Find the pull request

- If a conversation message (usually the `merge` one) already has a PR URL (`…/pull/<n>`), do nothing. The archive picks it up.
- Otherwise, ask GitHub from the project directory:

```bash
cd {task.project.workingDirectory}
gh pr list --head {task.recommendedBranch} --state all --json number,url,title,state --limit 5
```

  Pass each matching URL in `pullRequests`. If `gh` is missing, not signed in, or finds nothing, archive without a PR. Never block on this step.

### 4. Write the overview

Write 3–8 Markdown bullets (under 200 words) for `overview`:

- What was built or changed, in plain words
- Key decisions or approaches, from the plan and the code submission
- How review went: rounds, change requests and what they asked for
- The outcome: the PR and its merge target
- Follow-ups or known gaps the agents noted, if any

Use only facts from the task. Do not invent anything. If the task has no submissions, say that in one bullet.

### 5. Archive

Call `archive_task`:

```json
{ "taskId": "<taskId>",
  "pullRequests": ["https://github.com/org/repo/pull/42"],
  "overview": "- Added a theme toggle to the header that persists the choice in localStorage.\n- Plan approved on the first round; one code change request (contrast in dark mode).\n- PR #42 into `main`." }
```

### 6. Report

Tell the user, for each task: the title, the summary path, the detailed path and the PR (or "no PR found"), plus any task you skipped and why. Mention that the files are in the working tree and are not committed.

## Errors

| Error | What to do |
|-------|------------|
| `Only complete tasks can be archived; this one is …` | Skip it. For `merged`, tell the user to confirm completion first. |
| `Task is already archived (…)` | Skip it. Re-run with `force: true` only if the user asked to regenerate it. |
| `Project working directory not found: …` | Report it. Pass `directory` only if the user gives a folder. |
| `Task has no project, …` | Report it. Pass `directory` only if the user gives a folder. |
| `Task not found.` | Report the id. |

## Git

`archive_task` only writes files. It does not stage, commit or push. Leave the files uncommitted unless the user asks. If they ask you to commit, stage **only** the new `archive/` files (`git add archive/<name>.summary.md archive/<name>.detailed.md`) and commit them on the current branch. Never include other changes, and never push unless asked.

## Guardrails

- **NEVER** use the HTTP API (curl/fetch). Use the AgentQ MCP tools, and use `gh` only to read PRs (`gh pr list`, `gh pr view`).
- **DO NOT** change a task's status: no `claim_task`, no `submit_*`, no confirming completion for the user.
- **DO NOT** pass `force` unless the user explicitly asked to re-archive.
- **DO NOT** hand-edit or delete archive files. To refresh them, re-archive with `force` (when asked).
- **DO NOT** invent facts in the overview. Everything must come from the task.
- **DO NOT** commit or push the archive files unless the user asks.
- **DO** archive every requested task in one pass without asking for confirmation on each, and report the results at the end.
