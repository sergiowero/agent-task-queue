## 1. Tooling & Config

- [x] 1.1 Create root `tsconfig.json` with shared compiler options (strict, ESNext target, bundler module resolution)
- [x] 1.2 Fix `packages/installer/tsconfig.json` to correctly extend the root tsconfig
- [x] 1.3 Add ESLint flat config (`eslint.config.js`) at root with TypeScript, React, and import plugins
- [x] 1.4 Add Prettier config (`.prettierrc`) and `.prettierignore`
- [x] 1.5 Add `"type": "module"` and `"packageManager"` to root `package.json`
- [x] 1.6 Add `.gitattributes` enforcing LF line endings for `.ts`, `.tsx`, `.json`, `.css`, `.md` files
- [x] 1.7 Fix `.gitignore`: remove `.github/` block, add `*.tsbuildinfo` exception
- [x] 1.8 Add `lint`, `format`, and `typecheck` scripts to root `package.json`
- [x] 1.9 Add Vite production build optimization (manual chunk splitting for react, react-router, tanstack-query)
- [x] 1.10 Add environment variable validation with Zod for `PORT`, `AGENTQ_DB_PATH`
- [x] 1.11 Run ESLint auto-fix and Prettier format on all existing source files
- [x] 1.12 Add husky + lint-staged for pre-commit linting/formatting

## 2. Database Schema Changes

## 2. Database Schema Changes

- [x] 2.1 Add `deleted_at TEXT` column to tasks table schema
- [x] 2.2 Add `deleted_at TEXT` column to projects table schema
- [x] 2.3 Add `deleted_at TEXT` column to agents table schema
- [x] 2.4 Create `conversation_entries` table with columns: id, task_id, author_name, timestamp, message, message_type
- [x] 2.5 Create `status_history` table with columns: id, task_id, pre_status, new_status, timestamp
- [x] 2.6 Add `CREATE INDEX` statements for: `idx_tasks_project_id`, `idx_tasks_status`, `idx_activity_task_id`, `idx_activity_created_at`, `idx_conv_task_id`, `idx_history_task_id`
- [x] 2.7 Write data migration: extract existing JSON `conversation` into `conversation_entries` table
- [x] 2.8 Write data migration: extract existing JSON `history` into `status_history` table
- [x] 2.9 Write data migration: normalize `TaskStatus.ReadyForCode` from `"ready for code"` to `"ready_for_code"`
- [x] 2.10 Write rollback/down migration for all schema changes

## 3. Workflow Refactor (Shared)

- [x] 3.1 Create `types.ts` in `@agentq/shared` — ensure `deletedAt` field on Task, Project, Agent
- [x] 3.2 Normalize `TaskStatus.ReadyForCode` to `"ready_for_code"` in the enum
- [x] 3.3 Extract `recordHistory()` as a pure function in `@agentq/shared/src/workflow.ts`
- [x] 3.4 Extract `addConversation()` as a pure function in `@agentq/shared/src/workflow.ts`
- [x] 3.5 Extract `addActivity()` as a pure function in `@agentq/shared/src/workflow.ts`
- [x] 3.6 Extract `getClaimTransition()`, `getEffectiveRole()`, `getClaimableStatuses()` into `@agentq/shared/src/workflow.ts`
- [x] 3.7 Add Zod validation schemas for all CLI and API inputs in `@agentq/shared/src/schemas.ts`
- [x] 3.8 Add pagination utility types (`PaginatedResponse<T>`) and SQL helper to `@agentq/shared`
- [x] 3.9 Update `@agentq/shared/src/index.ts` to export all new modules
- [ ] 3.10 Update tests in shared package for new workflow functions and schemas

## 4. Backend Enhancements (Web Server)

- [x] 4.1 Add structured request logging middleware (method, path, status, duration)
- [x] 4.2 Add global error handler — wrap all routes in try/catch with 500 response
- [x] 4.3 Improve `parseBody` — return specific "Invalid JSON" error instead of silent null
- [x] 4.4 Add Zod validation for all POST/PUT endpoints using schemas from `@agentq/shared`
- [x] 4.5 Import workflow functions from `@agentq/shared` and remove duplicated `recordHistory`, `addConversation` from web server
- [x] 4.6 Wrap all workflow transition handlers in SQLite transactions
- [x] 4.7 Implement soft delete for tasks (`DELETE /api/tasks/:id` sets `deleted_at`)
- [x] 4.8 Implement hard delete for tasks (`DELETE /api/tasks/:id?hard=true`)
- [x] 4.9 Implement soft delete for projects (`DELETE /api/projects/:id` sets `deleted_at`)
- [x] 4.10 Implement hard delete for projects (`DELETE /api/projects/:id?hard=true`)
- [x] 4.11 Add pagination (limit/offset) to GET /api/tasks with total count
- [x] 4.12 Add pagination (limit/offset) to GET /api/activity with total count
- [x] 4.13 Add pagination (limit/offset) to GET /api/agents with total count
- [x] 4.14 Fix SSE keepalive — replace create/clear pattern with single persistent interval
- [x] 4.15 Extract SPA fallback (`serveIndexHtml`) into a single helper function
- [x] 4.16 Add Vite dev server crash detection and auto-restart
- [x] 4.17 Update `getTasks`, `getProjects`, `getAgents` queries to filter `WHERE deleted_at IS NULL`
- [x] 4.18 Move database functions to use normalized tables (read/write conversation_entries, status_history)

## 5. CLI Improvements

- [x] 5.1 Change `--worktree` on `submit-code` from `.option()` to `.requiredOption()`
- [x] 5.2 Fix `jsonError` — write JSON errors to stderr instead of stdout
- [x] 5.3 Add typed interfaces for all CLI command option parameters
- [x] 5.4 Import workflow functions from `@agentq/shared` and remove duplicated `recordHistory`, `addConversation` from CLI
- [x] 5.5 Add usage examples to CLI command help text

## 6. Frontend Enhancements — UX & Accessibility

- [x] 6.1 Add `react-hot-toast` dependency and create a toast provider
- [x] 6.2 Add toast notifications to all mutation handlers on TaskDetailPage
- [x] 6.3 Add toast notifications to CreateTaskModal and EditProjectModal
- [x] 6.4 Add `LoadingSkeleton` component with animated placeholder cards
- [x] 6.5 Add skeleton to BoardPage columns while tasks load
- [x] 6.6 Add skeleton to TaskDetailPage while task loads
- [x] 6.7 Add empty state components with SVG icons for Board, Projects, Activity, Agents pages
- [x] 6.8 Add `focus-trap-react` dependency and wrap all modals
- [x] 6.9 Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to CreateTaskModal
- [x] 6.10 Add same ARIA attributes to EditProjectModal and DeleteConfirmModal
- [x] 6.11 Add React Error Boundaries wrapping each route in App.tsx
- [x] 6.12 Fix ActivityPage: replace hardcoded `text-gray-*` and `border-gray-*` with theme CSS variable classes
- [x] 6.13 Fix BoardPage status filter: map raw enum values to human-readable labels
- [x] 6.14 Fix conversation entry cards: use stable keys (`timestamp + authorName`) instead of array index

## 7. Frontend Enhancements — Performance & Types

- [x] 7.1 Create shared TypeScript interfaces for all API response types (replacing `any`)
- [x] 7.2 Update `api.ts` to use typed response interfaces
- [x] 7.3 Update all components and pages to use typed data instead of `any`
- [x] 7.4 Fix SSE hook: use `queryClient.setQueryData` to patch specific task in cache instead of full invalidate
- [x] 7.5 Fix TaskCard: store RAF ID from `requestAnimationFrame` and cancel on unmount
- [x] 7.6 Remove `refetchInterval: 5000` from TaskDetailPage (SSE is the update mechanism)

## 8. Testing

- [x] 8.1 Add test DB isolation — set `AGENTQ_DB_PATH=:memory:` in test setup
- [x] 8.2 Add tests for soft-delete behavior (create, soft delete, list excludes, hard delete)
- [x] 8.3 Add tests for workflow refactor (recordHistory, addConversation in shared)
- [x] 8.4 Add tests for Zod validation schemas
- [x] 8.5 Add tests for paginated queries
- [x] 8.6 Add tests for transaction wrapping (verify rollback on failure)
- [x] 8.7 Add tests for CLI commands with typed options
- [x] 8.8 Add component tests for modals (focus trap, ARIA, escape key) using React Testing Library
- [x] 8.9 Final cleanup — remove legacy duplicated workflow code from CLI and web server, run full lint + typecheck + test suite
