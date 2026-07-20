## Why

ATQ has a REST API and CLI but no visual interface. Users need a Kanban-style web portal to supervise agent work, review plans and code, track agent activity, and steer tasks through the full workflow — all without leaving the browser. The current 4-status MVP doesn't reflect the 15+ state workflow defined in project.md.

## What Changes

- Add a React + Vite frontend application (`packages/web-ui`) serving a task board, task detail drawer, agents view, and activity feed
- Extend the REST API with endpoints for agents, projects, conversations, activity, and workflow transitions (claim, approve, request changes, etc.)
- Expand the shared data model to support the full workflow (15+ states), agent entities, project entities, conversation/history entries
- Add real-time updates via Server-Sent Events so the board stays current without manual refresh

## Capabilities

### New Capabilities

- `web-portal`: React + Vite frontend with Kanban board, task detail drawer, agents view, and activity feed
- `agent-management`: Auto-registration of agents through CLI claim actions, read-only agent listing for the web portal
- `project-management`: API endpoints and data model for creating, listing, updating, and deleting projects
- `workflow-transitions`: API endpoints that enforce valid state transitions for user actions (approve, request changes, cancel) and agent actions (claim, submit plan/code/review/merge)
- `activity-feed`: API endpoint and data model for a global activity stream of task state changes, comments, and agent actions

### Modified Capabilities

- `task-management`: Expand from 4 statuses to the full 15+ workflow states; add conversation, history, and contexts fields
- `shared-entities`: Add TaskStatus values, Agent type, Project type, ConversationEntry, StatusHistoryEntry; update database schema
- `web-server`: Add new REST API routes for agents, projects, workflow transitions, and activity feed; serve the web-ui static assets

## Impact

- **New package**: `packages/web-ui` (React + Vite)
- **Database**: Schema migration — new `agents`, `projects` tables; expanded `tasks` table with conversation, history, contexts columns
- **API**: Breaking changes to task response shape (new fields), new endpoints under `/api/agents`, `/api/projects`, `/api/activity`, `/api/tasks/:id/*`
- **Dependencies**: React, Vite, TypeScript, a CSS framework (e.g. Tailwind), SSE client library
- **Shared package**: Extended types and database functions consumed by both web server and web-ui API layer
