## Context

Current architecture:
- `packages/web`: Bun HTTP server on port 3000 serving REST + SSE under `/api/*`
- `packages/web-ui`: Vite + React dev server on port 5173, proxies `/api` to :3000
- Production: Vite builds to `dist/`, needs a separate HTTP server to serve it
- Two processes to run in development (`bun run web` + `bun run web:ui`)

Bun has built-in static file serving via `Bun.file()` and can conditionally proxy in dev mode. This makes unification straightforward without adding dependencies.

## Goals / Non-Goals

**Goals:**
- Single `bun run start` command runs everything
- In production, Bun serves both API and compiled UI from a single port
- In development, Bun serves API while proxying to Vite for HMR
- Remove the Vite proxy config (Bun becomes the single ingress)
- Maintain full HMR in development
- Zero new dependencies

**Non-Goals:**
- SSR or server-side rendering of React components
- Changing the React/Vite frontend architecture
- Removing Vite from development workflow (HMR is valuable)
- Production optimization beyond what Bun provides natively

## Decisions

**Decision 1: Bun serves static files directly in production**
- Bun's `Bun.file()` can read `packages/web-ui/dist/` and serve `index.html` + assets
- SPA fallback: any non-API, non-asset request returns `index.html`
- Rationale: zero dependencies, Bun runs the show, single port deployment

**Decision 2: In dev, Bun proxies non-API requests to Vite**
- Bun's `fetch` can forward requests to `localhost:5173`
- Vite stays in dev mode with HMR, Bun is the entry point
- Rationale: user hits one URL, Vite handles HMR, Bun handles API — best of both

**Decision 3: Single entry script with `--dev` flag**
- `bun run start` (production): Bun serves API + static dist/
- `bun run dev`: Bun starts, spawns Vite, proxies non-API to it
- Or: `bun run start --dev` for the combined mode
- Rationale: clear separation between dev and prod behavior

**Decision 4: Remove Vite's `/api` proxy**
- Once Bun is the ingress, the proxy is redundant and can cause confusion
- The React app calls `/api/*` which hits Bun directly in both modes
- Rationale: single source of truth for routing

## Risks / Trade-offs

- [Risk] Vite HMR won't work if Bun proxy is misconfigured → Mitigation: add health check; if Vite isn't running, fall back to serving static files with a warning
- [Risk] WebSocket connections (Vite HMR uses WebSockets) need passthrough → Mitigation: Bun's `Upgrade` header handling or explicit WS proxy
- [Risk] Dev startup latency: spawn Vite, wait for it, then start accepting → Mitigation: show a "waiting for Vite..." message, use `--wait` pattern
- [Trade-off] Slightly more complex dev server logic → Acceptable: it's ~30 lines of proxy + static serving middleware
- [Trade-off] Production still requires `bun run build` on web-ui first → Acceptable: this is standard practice, documented in README
