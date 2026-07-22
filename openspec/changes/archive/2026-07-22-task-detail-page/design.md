## Context

The task detail view currently lives in `TaskDrawer`, a 480px slide-in panel overlaid on the Kanban board. It has three tabs (Summary, Conversation, History) but messages are rendered identically regardless of type — agent, user, plan submissions, code submissions, and code reviews all look the same. The `ConversationEntry` type has no `messageType` field, so the frontend cannot distinguish message kinds.

The board uses a consistent status pill color scheme (purple=planning, blue=code/info, amber=warning/review, green=success, red=danger, grey=default) via the `Badge` component.

## Goals / Non-Goals

**Goals:**
- Replace the TaskDrawer slide-in panel with a full-page task detail view at `/tasks/:id/details`
- Add a `messageType` field to `ConversationEntry` for distinguishing message kinds
- Tag conversation entries on the backend with the appropriate type
- Render messages with distinct backgrounds/colors: user messages, agent messages, plan submissions, code submissions, code reviews/approvals
- Use the existing badge pill color variants for message type indicators
- Provide "Back to Board" navigation from the detail page
- Arrange page: task metadata/details at top, then 2 tabs (Conversation, History)

**Non-Goals:**
- Not modifying the existing Summary tab content — it moves to the page body
- Not adding new message types beyond what the backend currently creates
- Not changing the backend database schema (message type is derived at insert time)
- Not real-time editing of task fields from the detail page (read-only for now)

## Decisions

**1. Add `messageType` enum to `ConversationEntry`**
- New field: `messageType: "user" | "agent" | "plan" | "code" | "review" | "merge" | "system"`
- Default for existing entries: `"agent"` (backward compatible)
- Why: Enables the frontend to apply per-type styling without parsing message text

**2. Map backend submission endpoints to message types**
- `submit-plan` → `"plan"`
- `submit-code` → `"code"`
- `submit-review` → `"review"`
- `submit-merge` → `"merge"`
- User actions (approve, request changes, cancel) → `"user"`
- System transitions → `"system"`
- Generic agent messages → `"agent"`
- Why: Each endpoint knows what kind of message it creates; tagging at source is the cleanest approach

**3. New `/tasks/:id/details` route renders `TaskDetailPage`**
- `TaskDetailPage` fetches the task by ID and renders:
  - Header with title, status badge, and "Back to Board" button
  - Task metadata section (priority, branch, agent, worktree, acceptance criteria)
  - Two-tab section: Conversation | History
- Why: Separate route keeps the board component simple and follows existing routing patterns

**4. BoardPage navigates to detail page instead of opening drawer**
- `TaskCard` onClick becomes `navigate(/tasks/${task.id}/details)` instead of `setSelectedTaskId`
- Why: Clean separation — the board is the listing view, the detail page is the detail view

**5. Message color scheme maps to existing badge pill variants**
| Message Type | Badge Variant | Visual Effect |
|---|---|---|
| `"user"` | default | grey left border, neutral bg |
| `"agent"` | default | grey left border, neutral bg (slightly different shade from user) |
| `"plan"` | purple | violet left border + badge |
| `"code"` | info | blue left border + badge |
| `"review"` | warning | amber left border + badge |
| `"merge"` | success | green left border + badge |
| `"system"` | default | muted, italic |

- Why: Reuses the established color language from the board pills, creating visual consistency

**6. Keep TaskDrawer as a lightweight fallback or remove it**
- Option: Keep TaskDrawer for small screens / future mobile use but remove it from the current flow
- Decision: Remove TaskDrawer from BoardPage; TaskDrawer component can be deleted

**7. React Router v7 `useNavigate` for programmatic navigation**
- Why: Already used in the project (BoardPage already imports from react-router-dom)

## Risks / Trade-offs

- **Existing conversation entries lack `messageType`**: They'll default to `"agent"` on the frontend (backward-compatible). The backend migration is trivial — just default when reading old data.
- **Backend change is required**: The `addConversation` function needs updating to accept a `messageType`. All callers must pass the type. Risk is low — only 4 callers.
- **`/tasks/:id` route collision**: Currently `/tasks/:id` renders BoardPage. The new `/tasks/:id/details` route must be placed before `/tasks/:id` in the route config, or the existing route must change. Decision: place `/tasks/:id/details` before `/tasks/:id` (React Router picks the most specific match).
- **Full page reload on navigation**: Using client-side navigation (`useNavigate`), no full reload. Low risk.
