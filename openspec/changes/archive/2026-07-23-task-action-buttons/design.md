## Context

The task detail page (`TaskDetailPage`) was recently created as a full-page replacement for the old side drawer. Its action buttons are grouped at the bottom and gated by `ACTIVE_STATUSES`. The conversation tab shows messages but has no text input — the input is in the bottom action bar. Cancel is only available for `ACTIVE_STATUSES`. There is no backend guard against agent submissions on canceled tasks.

The user wants a cleaner split: conversation input inside the Conversation tab, inline action buttons next to the input for status-specific actions, Cancel always visible, and backend rejection of agent actions on canceled tasks.

## Goals / Non-Goals

**Goals:**
- Move the conversation text input from the bottom action bar into the Conversation tab
- Add context-sensitive buttons next to the input: "Request Plan Changes" (plan review), "Request Changes" (code review), "Add Comment" (various statuses)
- Keep action bar buttons: Cancel (always), Approve Plan (plan review), Approve (code review), Request AI Review (code review), Complete (merged)
- Backend: reject agent submissions (submit-plan, submit-code, submit-review, submit-merge) when task is Canceled, returning an error message to the agent
- Add a new `add-comment` backend endpoint for adding user comments without state transitions

**Non-Goals:**
- Not changing the agent submission logic for non-canceled statuses
- Not adding new message types (plain user messages work fine)
- Not changing the history tab or metadata section
- Not modifying the board, task card, or any other page

## Decisions

**1. Conversation input and inline buttons rendered as a sticky footer inside the Conversation tab**
- A fixed bottom area within the tab scroll container: text input + inline button(s)
- The inline button changes based on status:
  - `waiting_plan_review`: "Request Plan Changes" (adds entry + changes status)
  - `waiting_code_review`: "Request Changes" (adds entry + changes status)
  - `planning`, `coding`, `ready for code`, `reviewing`, `merged`, `complete`: "Add Comment" (adds entry only)
- Why: Keeps input and action colocated with the conversation content

**2. Bottom action bar is simplified**
- Cancel button: always visible, positioned at the bottom of the page
- Approve Plan: only during `waiting_plan_review`
- Approve (green): only during `waiting_code_review`
- Request AI Review (blue): only during `waiting_code_review`
- Complete: only during `merged`
- Why: Separates quick one-click actions (bottom bar) from text+action combos (conversation tab)

**3. Backend: reject agent submissions on Canceled tasks**
- In each submission handler (submit-plan, submit-code, submit-review, submit-merge), add a check at the top:
  - If `task.status === TaskStatus.Canceled`, return error 400 with message `"Task is canceled and cannot accept submissions."`
- Why: Simple, clear, no new state machinery needed

**4. New `add-comment` endpoint on the backend**
- Route: `POST /api/tasks/:id/add-comment`
- Body: `{ authorName, message }`
- Action: calls `addConversation` with `messageType: "user"`, no status change
- Why: "Add Comment" should not trigger any transition, just append to conversation

**5. Inline buttons reuse existing API functions**
- "Request Plan Changes" calls `requestPlanChanges` (existing)
- "Request Changes" calls `requestCodeChanges` (existing)
- "Add Comment" calls new `addComment` function
- "Approve Plan" calls `approvePlan` (existing)
- "Approve" calls `approveCode` (existing)
- "Request AI Review" calls `requestAiReview` (existing)
- "Complete" calls `confirmCompletion` (existing)
- "Cancel" calls `cancel` (existing)
- Why: No new workflow logic needed except for add-comment

## Risks / Trade-offs

- **Inline button confusion**: User might not notice the inline button changes based on status. Mitigation: the button label is descriptive and changes clearly.
- **Canceled task still visible**: Canceled tasks remain on the board. This is existing behavior and out of scope.
- **Add comment available on merged/complete**: These are terminal statuses — comments won't trigger agent work, but they allow users to leave notes.
