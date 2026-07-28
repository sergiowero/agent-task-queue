## Context

The AgentQ project is a monorepo with 5 TypeScript packages (`shared`, `web`, `cli`, `web-ui`, `installer`) using Bun as runtime and package manager. SQLite (via `bun:sqlite`) is the database. The frontend uses React 19, React Router 7, TanStack Query, Vite, and Tailwind CSS 3.

Current pain points:
- No root tsconfig — `packages/installer/tsconfig.json` references a non-existent parent
- Zero linting/formatting tooling — inconsistent code style across packages
- Workflow state machine logic duplicated in both `cli/src/index.ts` and `web/src/index.ts`
- No input validation — all API bodies parsed with `JSON.parse` + ad-hoc null checks
- No error middleware — unhandled exceptions crash the server
- JSON columns for conversation/history prevent querying and create migration pain
- `TaskStatus.ReadyForCode` = `"ready for code"` breaks snake_case convention
- No soft delete — deletes are permanent with no audit trail
- No pagination — all endpoints return unbounded results
- SSE keepalive timer management is fragile
- Frontend has extensive `any` types, no accessibility, hardcoded dark mode colors, no toast feedback, no loading skeletons

## Goals / Non-Goals

**Goals:**
- Establish consistent tooling (ESLint, Prettier, tsconfig) across all packages
- Eliminate duplicated workflow logic by centralizing in `@agentq/shared`
- Add request validation with Zod schemas for every API endpoint
- Add structured error handling middleware with proper error responses
- Add pagination to list endpoints (tasks, activity, agents)
- Implement soft delete with `deleted_at` for projects, tasks, and agents
- Normalize conversation/history into separate DB tables
- Fix all identified frontend UX and accessibility issues
- Add comprehensive test infrastructure with DB isolation
- Fix SSE, polling, and timer-related bugs

**Non-Goals:**
- Full redesign of the UI (no new pages or major layout changes)
- Authentication/authorization system
- WebSocket replacement of SSE
- Migration to a full ORM (staying with `bun:sqlite`)
- Adding a backend framework (staying with raw `Bun.serve()`)

## Decisions

| # | Decision | Rationale | Alternatives Considered |
|---|----------|-----------|------------------------|
| D1 | **ESLint flat config** (v9+) | Modern standard, simpler than `.eslintrc`, works with TypeScript + React | `.eslintrc` (legacy, deprecated) |
| D2 | **Zod** for validation | Runtime + type safety, zero-dependency for consumers, excellent DX | Joi (heavier), Yup (worse TS support), class-validator (decorators needed) |
| D3 | **Separate tables for conversation/history** rather than keeping JSON columns | Enables SQL querying, FK constraints, pagination; migration is one-time cost | JSON columns (current — loses queryability, fragile migrations) |
| D4 | **Soft delete via `deleted_at` column** | Simple, reversible, audit trail. Queries default to `WHERE deleted_at IS NULL` | Hard delete (irreversible), separate archive table (complex CRUD) |
| D5 | **Workflow functions move to `@agentq/shared`** as pure functions | Single source of truth, shared types, testable in isolation | Shared lib (same idea), inheritance (anti-pattern here) |
| D6 | **SSE direct cache update** instead of full invalidation | Avoids waterfall re-fetches; use `queryClient.setQueryData` to patch specific task | Full invalidation (current — wasteful) |
| D7 | **`focus-trap-react`** for modal focus trapping | Lightweight, React-native, well maintained | `focus-trap` (manual), Radix Dialog (heavy) |
| D8 | **`react-hot-toast`** for notifications | Tiny (~5KB), zero-config, works with React 19 | `react-toastify` (larger), custom (more work) |
| D9 | **`refetchInterval` removal + SSE as sole real-time mechanism** | Eliminates redundant polling; SSE already pushes all events | Keep both (duplicate traffic) |
| D10 | **Transaction wrapping via `db.transaction()`** | Atomic multi-step operations prevent partial state corruption | Manual rollback on error (error-prone) |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Schema migration for JSON column normalization** could lose existing conversation/history data | Write a careful migration script using `json_each` to extract and insert into new tables; test on a copy of production DB |
| **`TaskStatus.ReadyForCode` value change** is breaking for external consumers | Keep backward compatibility: accept both `"ready for code"` and `"ready_for_code"` in queries for one version, log deprecation warning |
| **Soft delete changes API semantics** — existing callers expecting hard delete might accumulate deleted rows | Add `?hard=true` query param for actual delete; document in API |
| **Adding ESLint + Prettier** to existing codebase will flag many existing issues | Run auto-fix first, then bulk-fix remaining issues in a dedicated pass; use warn level for stylistic rules |
| **New dependencies** (zod, react-hot-toast, focus-trap-react) increase bundle size | All are small (< 10KB gzipped) and justified by value; verify with `bun run build --analyze` |
| **DB transaction performance** — SQLite serializes writes | Acceptable for this scale; if contention grows, consider WAL mode (already enabled) |

## Migration Plan

1. **Phase 1 — Tooling & Config** (items 1-10): ESLint, Prettier, tsconfig, gitignore, package.json, `.gitattributes`
2. **Phase 2 — Database schema changes**: Add `deleted_at` columns, create conversation/history tables, add indexes, run data migration
3. **Phase 3 — Workflow refactor**: Extract `recordHistory`, `addConversation`, transition helpers to `@agentq/shared`; update CLI and web to import from there
4. **Phase 4 — Backend enhancements**: Zod validation, error middleware, logging, pagination, soft delete, SSE fix, SPA dedup
5. **Phase 5 — CLI fixes**: `--worktree` required, JSON stderr, typed options
6. **Phase 6 — Frontend enhancements**: `any` → types, ActivityPage dark mode, toasts, skeletons, empty states, focus trapping, ARIA, Error Boundaries, SSE optimization, status labels, RAF fix, index keys, polling removal
7. **Phase 7 — Testing**: DB isolation, expanded test coverage per package
8. **Phase 8 — Cleanup**: Remove legacy code, final lint/format pass

Rollback strategy: Each phase is independently revertible. DB migration has a down-script.

## Open Questions

- Should the `TaskStatus` normalization happen as a separate controlled migration (recommended) or transparently in code with a background migration?
- For JSON column normalization: should we keep the old columns as read-only fallback during transition?
