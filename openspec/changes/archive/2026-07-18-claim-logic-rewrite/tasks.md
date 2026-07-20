## 1. Database Layer

- [x] 1.1 Add `getNextClaimableTask(statuses: string[])` function to `packages/shared/src/database.ts` — queries tasks by status IN list, assigned_agent IS NULL, orders by priority DESC, created_at ASC, LIMIT 1
- [x] 1.2 Add unit tests for `getNextClaimableTask` — test priority ordering, tiebreaker by created_at, skip claimed tasks, empty result

## 2. CLI Claim Command

- [x] 2.1 Add `claim` command to `packages/cli/src/index.ts` with required flags: `--name`, `--version`, `--model`, `--role`, `--session-id`
- [x] 2.2 Implement role-to-status mapping in CLI: planner → [New, Plan Changes Requested], implementer → [Ready, Changes Requested, Approved], reviewer → [Code Review Requested]
- [x] 2.3 Implement compound role logic: senior = planner + implementer + reviewer; architect = planner + reviewer (no implementer)
- [x] 2.4 Implement claim flow: call `getNextClaimableTask`, create/update agent record, update task status and assignedAgent, record history, add conversation entry
- [x] 2.5 Implement claim output: print task title, description, acceptance criteria, recommended branch, merge branch, new status
- [x] 2.6 Handle no-tasks-available case: print "No tasks available for your role" and exit 0

## 3. CLI Submit Commands

- [x] 3.1 Add `submit-plan` command to CLI — accepts task-id and --message, transitions Planning → Waiting Plan Review, clears assignedAgent
- [x] 3.2 Add `submit-code` command to CLI — accepts task-id and --message, transitions Coding → Waiting Code Review, clears assignedAgent
- [x] 3.3 Add `submit-review` command to CLI — accepts task-id and --message, transitions Reviewing → Waiting Code Review, clears assignedAgent
- [x] 3.4 Add `submit-merge` command to CLI — accepts task-id, --branch, --commit, --worktree (optional), --authors, transitions Merging → Merged, clears assignedAgent, stores merge details in conversation

## 4. Web Server Cleanup

- [x] 4.1 Remove `POST /api/tasks/:id/claim` case from switch in `packages/web/src/index.ts`
- [x] 4.2 Remove `getClaimTransition` function and `CLAIM_TRANSITIONS` constant from `packages/web/src/index.ts`
- [x] 4.3 Update web-server spec to mark claim endpoint as removed (returns 404)

## 5. Web UI Cleanup

- [x] 5.1 Audit `packages/web-ui` for any claim-related buttons or actions and remove them

## 6. Spec Updates

- [x] 6.1 Update `openspec/specs/workflow-transitions/spec.md` — replace agent claim scenarios with auto-assignment scenarios, add implementer-claims-Approved scenario, update submit-merge to include branch/commit/worktree/authors
- [x] 6.2 Update `openspec/specs/cli-app/spec.md` — add claim, submit-plan, submit-code, submit-review, submit-merge command specs with merge details (branch, commit, worktree, authors)
- [x] 6.3 Update `openspec/specs/web-server/spec.md` — remove claim endpoint scenario, add 404 for claim
- [x] 6.4 Create `openspec/specs/cli-claim/spec.md` — full spec for automatic task selection capability
