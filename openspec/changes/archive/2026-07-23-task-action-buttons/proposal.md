## Why

The current action buttons on the task detail page are inconsistent with the expected workflow. The Cancel button should always be visible (not gated by active statuses), the conversation text input needs to live inside the Conversation tab with inline action buttons (Request Plan Changes, Request Changes, Add Comment), and canceled tasks should reject agent submissions instead of processing them.

## What Changes

- **Cancel always visible** — Cancel Task button shows on every status, transitions to Canceled, clears assigned agent
- **Agent submissions ignored on canceled tasks** — Backend rejects submit-plan, submit-code, submit-review, submit-merge for Canceled tasks with notification to the agent
- **Conversation input inside Conversation tab** — Move text input from bottom action bar to inside the Conversation tab
- **Request Plan Changes button** — Visible to the right of conversation input when status is `waiting_plan_review`; adds entry to conversation and changes status to `plan_changes_requested`
- **Request Changes button** — Visible to the right of conversation input when status is `waiting_code_review`; adds entry to conversation and changes status to `changes_requested`
- **Add Comment button** — Visible next to conversation input when status is `planning`, `coding`, `ready for code`, `reviewing`, `merged`, or `complete`; adds a plain user message without changing state
- **Approve Plan button** — Visible in action bar during `waiting_plan_review`; transitions to `ready for code`
- **Approve button** (green) — Visible in action bar during `waiting_code_review`; transitions to `approved`
- **Request AI Review button** (blue) — Visible in action bar during `waiting_code_review`; transitions to `code_review_requested`
- **Complete button** — Visible in action bar for `merged` status; transitions to `complete`

## Capabilities

### New Capabilities
- (none — this modifies existing behavior)

### Modified Capabilities
- `web-portal`: Update task detail page button layout, conversation input placement, and action button visibility rules
- `workflow-transitions`: Add cancel-rejects-submissions rule and add-comment action

## Impact

- **packages/web-ui/src/pages/TaskDetailPage.tsx**: Rework action buttons, move conversation input to Conversation tab, change button visibility logic
- **packages/web/src/index.ts**: Reject agent submissions when task is Canceled; add `add-comment` endpoint
- **packages/web-ui/src/lib/api.ts**: Add `addComment` API function
- **packages/shared/src/types.ts**: No changes needed (messageType already supports "user" for comments)
