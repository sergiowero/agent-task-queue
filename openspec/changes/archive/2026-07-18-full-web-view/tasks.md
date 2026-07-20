## 1. Shared Package — Data Model Expansion

- [x] 1.1 Expand TaskStatus enum to all 15 workflow states (New, Planning, WaitingPlanReview, PlanChangesRequested, Ready, Coding, WaitingCodeReview, CodeReviewRequested, Reviewing, ChangesRequested, Approved, Merging, Merged, Complete, Canceled)
- [x] 1.2 Add Agent, Project, ConversationEntry, StatusHistoryEntry, AgentReference types to shared/src/types.ts
- [x] 1.3 Add acceptancriteria, priority, recommendedBranch, realBranch, requiresPlan, mergeBranch, assignedAgent, conversation, history, contexts, projectId fields to Task type
- [x] 1.4 Create database migration script to ALTER existing tasks table and CREATE agents, projects, activity tables
- [x] 1.5 Implement createAgent, getAgentById, getAgents, updateAgentLastSeen database functions (createAgent used internally by claim flow)
- [x] 1.6 Implement createProject, getProjects, getProjectById, deleteProject database functions
- [x] 1.7 Implement addActivityEvent, getActivityEvents database functions
- [x] 1.8 Update createTask and updateTask to handle new fields
- [x] 1.9 Update getTasks to support projectId filter
- [x] 1.10 Export all new types and functions from shared/src/index.ts

## 2. Web Server — Workflow Transition Endpoints

- [x] 2.1 Create workflow validation module (rules for valid state transitions per role)
- [x] 2.2 Implement POST /api/tasks/:id/claim endpoint — creates/updates agent record internally, assigns task, transitions status
- [x] 2.3 Implement POST /api/tasks/:id/submit-plan endpoint
- [x] 2.4 Implement POST /api/tasks/:id/submit-code endpoint
- [x] 2.5 Implement POST /api/tasks/:id/submit-review endpoint
- [x] 2.6 Implement POST /api/tasks/:id/submit-merge endpoint
- [x] 2.7 Implement POST /api/tasks/:id/approve-plan endpoint
- [x] 2.8 Implement POST /api/tasks/:id/request-plan-changes endpoint
- [x] 2.9 Implement POST /api/tasks/:id/approve-code endpoint
- [x] 2.10 Implement POST /api/tasks/:id/request-code-changes endpoint
- [x] 2.11 Implement POST /api/tasks/:id/request-ai-review endpoint
- [x] 2.12 Implement POST /api/tasks/:id/confirm-completion endpoint
- [x] 2.13 Implement POST /api/tasks/:id/cancel endpoint
- [x] 2.14 Implement POST /api/tasks/:id/unblock endpoint

## 3. Web Server — Agent Read, Project, and Activity Endpoints

- [x] 3.1 Implement GET /api/agents (read-only, agents created via CLI claims) with role and tool filters
- [x] 3.2 Implement POST /api/projects, GET /api/projects, DELETE /api/projects/:id endpoints
- [x] 3.3 Implement GET /api/activity with taskId, agentId, date range, and limit filters
- [x] 3.4 Update existing task endpoints to return expanded task shape with conversation, history, contexts

## 4. Web Server — SSE Events Endpoint

- [x] 4.1 Implement /api/events SSE endpoint with connection tracking
- [x] 4.2 Emit SSE events on every task status change and conversation update
- [x] 4.3 Handle client disconnect and connection cleanup

## 5. Web UI — Project Setup

- [x] 5.1 Initialize packages/web-ui with React + Vite + TypeScript + Tailwind CSS
- [x] 5.2 Configure Vite proxy to forward /api requests to the Bun web server on port 3000
- [x] 5.3 Set up React Router with routes for board, agents, and activity views
- [x] 5.4 Set up TanStack Query provider and API client utility

## 6. Web UI — Board View

- [x] 6.1 Create Kanban board layout with four columns (Pending, In Progress, Need Review, Done)
- [x] 6.2 Implement task card component showing title, priority, branch, status, agent, and badges
- [x] 6.3 Fetch tasks and group by workflow status into board columns
- [x] 6.4 Implement column show/hide settings toggle
- [x] 6.5 Implement top bar with search, project filter, and status/agent/tool/model filters
- [x] 6.6 Implement task creation form (new task button, modal with all required fields)
- [x] 6.7 Wire SSE connection to auto-update task cards on server push

## 7. Web UI — Task Detail Drawer

- [x] 7.1 Create right-side drawer component with Summary, Conversation, and History tabs
- [x] 7.2 Implement Summary tab showing all task metadata fields
- [x] 7.3 Implement Conversation tab showing chronological message thread
- [x] 7.4 Implement History tab showing status transition timeline
- [x] 7.5 Implement user action buttons: Approve Plan, Request Plan Changes, Approve Code, Request Code Changes, Request AI Review, Cancel, Unblock
- [x] 7.6 Implement inline task metadata editing in Summary tab
- [x] 7.7 Wire action buttons to workflow transition API endpoints

## 8. Web UI — Agents View

- [x] 8.1 Create agents table with columns: name, tool, model, role, session ID, last seen, current task
- [x] 8.2 Implement active/inactive visual distinction (last seen within 5 minutes)
- [x] 8.3 Implement role and tool filter controls
- [x] 8.4 Implement agent detail panel showing compact activity feed

## 9. Web UI — Activity Feed View

- [x] 9.1 Create activity timeline component showing events with timestamps
- [x] 9.2 Fetch activity feed from /api/activity endpoint
- [x] 9.3 Implement filters for agent, date range, and event type
- [x] 9.4 Make task links in events clickable to open task drawer

## 10. Web UI — Layout and Polish

- [x] 10.1 Implement left sidebar with project list and project creation
- [x] 10.2 Implement top bar with search and filter controls
- [x] 10.3 Add keyboard shortcuts for common actions (refresh, navigate)
- [x] 10.4 Add empty states and first-time user hints
- [x] 10.5 Add confirmation dialogs for destructive actions (cancel, delete)

## 11. Integration and Verification

- [x] 11.1 Verify web server serves web-ui static assets in production mode
- [x] 11.2 End-to-end test: create project, create task, agent claims, submits plan, user approves, agent codes, user approves, agent merges, user completes
- [x] 11.3 Test SSE reconnection after connection drop
- [x] 11.4 Test column show/hide and filter combinations on board view
- [x] 11.5 Verify database migration from existing 4-status schema to full workflow schema
