## Why

The current task details panel is a 480px side drawer that hides to the right, forcing users into a cramped view. Users need a full-page task detail view that provides more space, clear navigation back to the board, and visually distinct message types (agent vs user, plans, code reviews, code submissions) using the existing status pill color scheme.

## What Changes

- **New task detail page** at `/tasks/:id/details` — full-width page replacing the side panel drawer
- **Navigation** — "Back to Board" button on the detail page; clicking a task card on the board navigates to the new page instead of opening the drawer
- **Layout** — task metadata/details as the first section, followed by a 2-tab setup: Conversation and History (removing the Summary tab — its contents move to the page body)
- **Message type colors** — add `type` field to `ConversationEntry`; render agent messages, user messages, plan submissions, code submissions, and code reviews with distinct background/border colors matching the status pill scheme (purple for plans, blue for code, amber for reviews, green for approvals)
- **ConversationEntry type** — extend the shared type with a `messageType` field to distinguish message kinds
- **Backend** — tag conversation entries with the appropriate type on creation (submit-plan, submit-code, submit-review, user actions, etc.)
- **Remove or repurpose TaskDrawer** — the drawer component can be simplified or removed in favor of the new page

## Capabilities

### New Capabilities
- `task-detail-page`: Full-page task detail view with rich message type styling, 2-tab conversation/history layout, and board navigation

### Modified Capabilities
- (none — no existing spec-level behavior changes)

## Impact

- **packages/shared/src/types.ts**: Add `messageType` field to `ConversationEntry`
- **packages/web/src/index.ts**: Tag conversation entries with message type on creation
- **packages/web-ui/src/App.tsx**: Add route for `/tasks/:id/details`
- **packages/web-ui/src/pages/BoardPage.tsx**: Change task card click to navigate to detail page instead of opening drawer
- **packages/web-ui/src/components/TaskDrawer.tsx**: Can be removed or simplified
- **packages/web-ui/src/**: New `TaskDetailPage.tsx` page component; new or updated message rendering with per-type coloring
- **packages/web-ui/src/components/Badge.tsx**: Reuse existing pill color scheme for message type indicators
