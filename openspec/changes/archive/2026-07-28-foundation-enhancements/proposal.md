## Why

The AgentQ codebase has grown rapidly without establishing core engineering foundations: no linting/formatting, no input validation, no error handling middleware, duplicated workflow logic across packages, no pagination, no accessibility, and weak testing infrastructure. These gaps create maintenance friction, poor developer experience, and a brittle foundation for future features. This change addresses 40+ identified issues spanning configuration, architecture, backend, CLI, frontend, testing, and performance — plus adds soft-delete support across all entities.

## What Changes

- Add ESLint + Prettier with shared configs and pre-commit hooks
- Create root `tsconfig.json` and fix the broken `extends` chain
- Add `"type": "module"` and `"packageManager"` to root `package.json`
- Fix `.gitignore` (remove `.github/` block, add missing patterns)
- Add `.gitattributes` for consistent line endings
- Optimize Vite production build (chunk splitting, compression)
- Add environment variable validation with `zod`
- Upgrade Vite proxy config for production
- Move duplicated workflow logic (state transitions, history, conversation) from CLI and web into `@agentq/shared`
- Add ZOD input validation schemas for all API request bodies
- Add structured request logging middleware
- Add global error handler returning structured 500 responses
- Add proper malformed JSON error messages
- Add pagination (limit/offset) to tasks, activity, and agents APIs
- Add SQLite indexes on foreign key columns
- Wrap multi-step workflow operations in transactions
- Normalize `TaskStatus.ReadyForCode` from `"ready for code"` to `"ready_for_code"`
- Implement soft delete for projects, tasks, and agents (add `deleted_at` field, filter in queries)
- Fix SSE keepalive timer leak
- Add Vite dev server crash monitoring in dev mode
- Deduplicate SPA fallback logic
- Fix CLI `--worktree` to use `.requiredOption()`
- Fix CLI JSON error output to stderr
- Replace `any` types with proper interfaces across CLI and frontend
- Add TypeScript interfaces for all API responses in frontend
- Fix ActivityPage dark mode (replace hardcoded gray with theme variables)
- Add toast notification system for mutation feedback
- Add loading skeleton components
- Add empty state illustrations
- Add focus trapping and ARIA attributes to all modals
- Add React Error Boundaries per route
- Optimize SSE hook to update cache directly instead of full re-fetch
- Map raw status enum values to human-readable labels in filters
- Fix TaskCard RAF cleanup on unmount
- Fix ConversationEntryCard to use stable keys
- Remove redundant `refetchInterval: 5000` from TaskDetailPage (SSE already pushes updates)
- Normalize conversation/history JSON columns into separate tables
- Expand test coverage with DB isolation and per-package tests
- Add `*.tsbuildinfo` to tracked files for incremental builds

## Capabilities

### New Capabilities
- `config-tooling`: ESLint, Prettier, root tsconfig, gitattributes, package.json standards
- `backend-error-handling`: Request validation (zod), error middleware, structured logging, pagination
- `soft-delete`: Soft delete for projects, tasks, and agents with `deleted_at` filtering
- `frontend-accessibility`: Focus trapping, ARIA attributes, keyboard nav, error boundaries
- `frontend-ux`: Toast notifications, loading skeletons, empty states, status labels, theme fixes
- `frontend-performance`: SSE direct cache update, remove duplicate polling, RAF cleanup
- `testing-foundation`: Test isolation, expanded coverage, per-package test suites
- `database-optimization`: Indexes, transactions, JSON column normalization
- `workflow-refactor`: Deduplicate workflow logic into `@agentq/shared`
- `cli-improvements`: Required flags, JSON output fixes, help examples, typed options

### Modified Capabilities
- `shared-entities`: Add `deletedAt` optional timestamp to `Task`, `Project`, `Agent` types
- `task-management`: Paginated task list API; `deleteTask` → soft delete with `actualDelete` flag
- `project-management`: Paginated project list API; `deleteProject` → soft delete
- `web-server`: New middleware pipeline, zod validation, paginated endpoints, structured errors
- `cli-app`: Updated options (`--worktree` required), JSON error output to stderr
- `ui-controls`: Badge, Button, Input, Textarea components updated with accessibility props
- `ui-theme`: ActivityPage uses CSS variable classes instead of hardcoded Tailwind grays
- `task-detail-page`: Remove polling, add toast feedback, fix conversation entry keys
- `ui-animations`: Loading skeleton animations

## Impact

- **Affected packages**: All 5 packages (`shared`, `web`, `cli`, `web-ui`, `installer`)
- **Database schema**: New `deleted_at` columns on tasks/projects/agents tables; new separate tables for conversation and history (migration required)
- **API contract changes**: Paginated responses (tasks, activity), soft delete semantics, `TaskStatus` value normalization (`ready for code` → `ready_for_code`)
- **New dependencies**: `zod`, `eslint`, `prettier`, `react-hot-toast` (or equivalent), `focus-trap-react`
- **Dev workflow**: New `lint`, `format`, and `typecheck` npm scripts; pre-commit hooks
- **Breaking**: `TaskStatus.ReadyForCode` string value changes; existing DB records with `"ready for code"` need migration; `deleteTask` and `deleteProject` become soft deletes by default
