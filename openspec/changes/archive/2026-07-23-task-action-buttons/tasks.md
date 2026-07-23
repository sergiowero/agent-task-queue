## 1. Backend - Cancel guards on agent submissions

- [x] 1.1 Add Canceled status check at top of submit-plan, submit-code, submit-review, submit-merge handlers in `packages/web/src/index.ts`
- [x] 1.2 Return 400 error with message "Task is canceled and cannot accept submissions." when agent tries to submit on Canceled task

## 2. Backend - Add Comment endpoint

- [x] 2.1 Add `add-comment` case in the sub-action switch in `packages/web/src/index.ts`
- [x] 2.2 Implement: call `addConversation` with `messageType: "user"`, no status change, no assignedAgent change

## 3. Frontend - API client

- [x] 3.1 Add `addComment` function to `packages/web-ui/src/lib/api.ts`

## 4. Frontend - Rework TaskDetailPage action buttons

- [x] 4.1 Remove `ACTIVE_STATUSES` gate — Cancel button is always visible at bottom of page
- [x] 4.2 Keep status-specific buttons in action bar: Approve Plan (waiting_plan_review), Approve (waiting_code_review), Request AI Review (waiting_code_review), Complete (merged)
- [x] 4.3 Remove the old feedback input from the bottom action bar

## 5. Frontend - Conversation input and inline buttons inside Conversation tab

- [x] 5.1 Add sticky footer inside Conversation tab with text input and a context-sensitive action button
- [x] 5.2 Show "Request Plan Changes" when status is waiting_plan_review — calls requestPlanChanges with input text
- [x] 5.3 Show "Request Changes" when status is waiting_code_review — calls requestCodeChanges with input text
- [x] 5.4 Show "Add Comment" when status is planning, coding, ready for code, reviewing, merged, or complete — calls addComment with input text
- [x] 5.5 Clear input after successful action

## 6. Verify

- [x] 6.1 Build web-ui and verify no errors
- [x] 6.2 Verify backend compiles without errors
