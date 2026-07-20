## Context

ATQ is a local agent task queue with a Bun-based monorepo: `packages/shared` (types + SQLite), `packages/web` (REST API), `packages/cli` (Commander.js). The current MVP implements basic CRUD with 4 task statuses. The full system described in project.md requires a 15+ state workflow, agent management, project isolation, conversation threads, and a visual Kanban dashboard. This change adds the web portal frontend and extends the backend to support the complete workflow.

## Goals / Non-Goals

**Goals:**
- Build a React + Vite SPA (`packages/web-ui`) that serves as the primary visual interface
- Implement a Kanban board with configurable columns mapping workflow states to action buckets
- Add a task detail drawer with tabs for summary, conversation, and history
- Add an agents view for monitoring active/idle agent sessions
- Add an activity feed showing a global timeline of task events
- Extend the REST API to support agents, projects, workflow transitions, and activity
- Expand the data model to the full 15+ state workflow with conversation, history, and contexts
- Use Server-Sent Events (SSE) for live board updates without polling

**Non-Goals:**
- User authentication (local-only tool, anyone on the machine can access)
- WebSocket support (SSE is sufficient for one-way server→client updates)
- Mobile-responsive layout (desktop-first as specified in project.md)
- Drag-and-drop between columns (project.md explicitly says moving between columns is not allowed; only reordering within a column)
- Real-time multi-user collaboration (single-user local tool)

## Decisions

### Frontend: React + Vite + Tailwind CSS
**Decision**: Use React 18 with Vite as the build tool and Tailwind CSS for styling.
**Rationale**: React has the largest ecosystem for component libraries (shadcn/ui for the drawer, tables, dialogs). Vite provides fast HMR and native ESM dev server. Tailwind enables rapid UI iteration without writing custom CSS files. All three are mature and well-documented.
**Alternatives considered**: SolidJS (smaller bundle but smaller ecosystem), Svelte (compiler-based but less familiar), vanilla Web Components (too manual for complex Kanban UI).

### State Management: React Query (TanStack Query)
**Decision**: Use TanStack Query for server state management.
**Rationale**: The app is fundamentally a view over server data. TanStack Query handles caching, background refetching, optimistic updates, and SSE integration out of the box. No need for Zustand/Redux — the server is the source of truth.
**Alternatives considered**: Zustand (would duplicate server state), Redux (overkill for this use case), raw fetch + useState (reinvents caching).

### Real-time: Server-Sent Events (SSE)
**Decision**: Use SSE for server→client push updates instead of WebSockets.
**Rationale**: The board only needs server→client direction (task updates, agent activity). SSE is simpler, works over standard HTTP, auto-reconnects, and doesn't require a separate protocol upgrade. The web server already uses Bun's native HTTP.
**Alternatives considered**: WebSockets (bidirectional but unnecessary complexity), polling (wasteful, laggy), GraphQL subscriptions (adds GraphQL dependency).

### Routing: React Router v6
**Decision**: Use React Router with a flat route structure.
**Rationale**: The app has 3 main views (board, agents, activity) plus a task detail drawer. Client-side routing enables direct linking to tasks (`/tasks/:id`) and browser history. React Router is the de-facto standard.
**Alternatives considered**: TanStack Router (newer, less ecosystem), file-based routing (Next.js-style, adds complexity for a SPA).

### Board Column Mapping: Hardcoded Configuration
**Decision**: Board columns are hardcoded per project.md specification with a settings UI to show/hide columns.
**Rationale**: The mapping (Pending→New/Ready/Plan Changes Requested/..., In Progress→Planning/Coding/Reviewing/Merging, etc.) is a core business rule. Making it configurable at the code level (not just UI toggle) would fragment the workflow logic. The settings UI lets users hide columns they don't care about.
**Alternatives considered**: Fully configurable column→status mapping (too complex, error-prone), no settings (less flexible).

### API Design: REST with SSE endpoint
**Decision**: Extend the existing REST API under `/api/` with new resources. Add `/api/events` for SSE stream.
**Rationale**: REST is already established in the codebase. SSE endpoint is a single long-lived GET that streams JSON events. No need for a separate real-time service.
**Alternatives considered**: GraphQL (adds schema layer, unnecessary for local tool), gRPC (overkill).

### CSS: Tailwind CSS v4
**Decision**: Use Tailwind CSS for all styling.
**Rationale**: Utility-first CSS enables rapid prototyping without leaving JSX. The "calm command center" aesthetic described in project.md is achievable with Tailwind's spacing, color, and typography utilities. shadcn/ui components are built on Tailwind.
**Alternatives considered**: CSS Modules (slower iteration), styled-components (runtime overhead), plain CSS (no design system).

## Risks / Trade-offs

- **Schema migration complexity** → The tasks table needs new columns (conversation, history, contexts, priority, branch fields, project_id). Mitigation: Write a migration script that ALTERs the existing table and backfills defaults. SQLite supports ALTER TABLE ADD COLUMN.
- **SSE connection management** → Multiple tabs or crashed clients leave orphaned connections. Mitigation: Server tracks connections by ID, cleans up on disconnect, uses Bun's built-in AbortController.
- **Shared package bloat** → Adding agent/project types and DB functions to shared increases its surface area. Mitigation: Keep shared focused on data types and DB operations only. Business logic (workflow rules) stays in the web server.
- **No auth** → Anyone on the local machine can manipulate tasks. Mitigation: Acceptable for local-only MVP. Document this as a known limitation.
- **Desktop-only layout** → Mobile users can't access the board. Mitigation: Per project.md specification, this is intentional for the MVP.
