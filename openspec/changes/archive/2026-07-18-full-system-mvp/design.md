## Context

This is a greenfield project for an agent task queue system. The system needs to support both web-based and CLI-based interfaces for managing tasks. The core requirement is a shared codebase that both interfaces can use, with SQLite for persistent storage.

## Goals / Non-Goals

**Goals:**
- Create a monorepo structure with shared core logic
- Implement a REST API server using Bun's native HTTP server
- Implement a CLI application using Commander.js or similar
- Use SQLite via better-sqlite3 for local persistence
- Share TypeScript types and database schemas between web and CLI

**Non-Goals:**
- User authentication (can be added later)
- WebSocket support (REST only for MVP)
- Complex task scheduling or cron jobs
- Multi-user support with permissions

## Decisions

### Runtime: Bun
**Decision**: Use Bun as the JavaScript/TypeScript runtime
**Rationale**: Bun provides native TypeScript support, fast execution, and built-in features like SQLite support. It simplifies the development stack.
**Alternatives considered**: Node.js (would require ts-node or compilation step)

### Database: SQLite via better-sqlite3
**Decision**: Use better-sqlite3 for SQLite access
**Rationale**: Synchronous API is simpler for this use case, good performance, well-maintained. Bun also has native SQLite but better-sqlite3 is more mature.
**Alternatives considered**: Bun's native SQLite (less mature), Drizzle ORM (adds complexity for MVP)

### Web Framework: Native Bun HTTP
**Decision**: Use Bun's native HTTP server instead of Express/Hono
**Rationale**: For an MVP with simple REST endpoints, native HTTP is sufficient. Reduces dependencies.
**Alternatives considered**: Express (more features but heavier), Hono (good but adds dependency)

### CLI Framework: Commander.js
**Decision**: Use Commander.js for CLI argument parsing
**Rationale**: Well-established, good TypeScript support, minimal bundle size
**Alternatives considered**: Yargs (more complex), Bun's built-in parseArgs (less feature-rich)

### Project Structure: Monorepo with shared package
**Decision**: Use a monorepo structure with a shared package for entities and database logic
```
agent-task-queue/
├── packages/
│   ├── shared/          # Shared types, database, entities
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   ├── database.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── web/             # REST API server
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── package.json
│   └── cli/             # CLI application
│       ├── src/
│       │   └── index.ts
│       └── package.json
└── package.json         # Root workspace config
```
**Rationale**: Clear separation of concerns while enabling code sharing. Bun supports workspaces natively.
**Alternatives considered**: Single package with separate entry points (less clear separation)

## Risks / Trade-offs

- **SQLite concurrency** → SQLite handles concurrent reads well but writes are serialized. For an MVP with moderate load, this is acceptable. Could migrate to PostgreSQL later if needed.
- **Bun maturity** → Bun is relatively new. Mitigation: Use well-established libraries (better-sqlite3, commander) for critical paths.
- **No authentication** → Anyone with access can modify tasks. Mitigation: Acceptable for local development MVP. Add auth in future iteration.
