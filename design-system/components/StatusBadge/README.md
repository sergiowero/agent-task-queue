# StatusBadge

A Badge for a task's workflow status, with its label, tone, icon and live pulse taken from `TASK_STATUS`.

- Supply `status` (the API value, e.g. `"waiting_code_review"`) and optionally `size`. An unknown status shows its raw name, de-underscored, in neutral.
- Live statuses (planning, coding, reviewing, merging) show a pulsing dot instead of an icon.
- `JobStatusBadge` does the same for runner jobs: running, succeeded, failed, reverted.
- Never hand-build a status chip. Add the status to `TASK_STATUS` so the board, detail page and filters stay in sync.
