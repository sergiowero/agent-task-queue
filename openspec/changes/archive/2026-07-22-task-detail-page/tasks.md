## 1. Data Model - Add messageType to ConversationEntry

- [x] 1.1 Add `messageType` field to `ConversationEntry` interface in `packages/shared/src/types.ts`
- [x] 1.2 Update `addConversation` function in `packages/web/src/index.ts` to accept and store `messageType`
- [x] 1.3 Tag entries with correct type in all submission handlers: `submit-plan` → `"plan"`, `submit-code` → `"code"`, `submit-review` → `"review"`, `submit-merge` → `"merge"`
- [x] 1.4 Tag user action entries (approve plan, approve code, request changes, cancel) with `messageType: "user"`

## 2. Routing - Add Task Detail Page Route

- [x] 2.1 Add `/tasks/:id/details` route in `packages/web-ui/src/App.tsx` pointing to new `TaskDetailPage`
- [x] 2.2 Update `BoardPage.tsx` to navigate to `/tasks/:id/details` on task card click instead of opening TaskDrawer
- [x] 2.3 Remove `TaskDrawer` import and usage from `BoardPage.tsx`
- [x] 2.4 Delete `TaskDrawer.tsx` component file

## 3. Task Detail Page Component

- [x] 3.1 Create `packages/web-ui/src/pages/TaskDetailPage.tsx` with task data fetching via `useQuery`
- [x] 3.2 Render page header with task title, status badge, and "Back to Board" button using `useNavigate`
- [x] 3.3 Render task metadata section (description, priority, branch, agent, worktree, acceptance criteria)
- [x] 3.4 Render two-tab section below metadata: "Conversation" and "History" tabs
- [x] 3.5 Implement History tab with status transition entries (reuse from current TaskDrawer)

## 4. Per-Type Message Rendering

- [x] 4.1 Create `ConversationEntryCard` component with type-aware styling
- [x] 4.2 Map `messageType` values to badge pill colors: plan→purple, code→blue/info, review→amber/warning, user→default, agent→default, merge→success/green, system→muted
- [x] 4.3 Render type badge label next to author name (e.g., "Plan", "Code", "Review", "User", "Agent", "Merge")
- [x] 4.4 Apply left border color matching the message type
- [x] 4.5 Apply subtle background tint per message type for additional visual distinction

## 5. Verify and Clean Up

- [x] 5.1 Verify BoardPage no longer references TaskDrawer
- [x] 5.2 Verify all conversation entries across the API (submit-plan, submit-code, submit-review, submit-merge, user actions) carry `messageType`
- [x] 5.3 Verify backward compatibility: old entries without `messageType` default to `"agent"`
- [x] 5.4 Run type check: build passed with `tsc -b` in web-ui package
- [x] 5.5 Build the project and verify no errors
