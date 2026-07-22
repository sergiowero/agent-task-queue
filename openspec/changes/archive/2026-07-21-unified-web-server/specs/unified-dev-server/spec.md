## Behavior

### Production Mode (`bun run start`)
1. Bun starts on port 3000
2. All `/api/*` requests → REST handlers + SSE (unchanged)
3. All other requests → serve from `packages/web-ui/dist/`
   - If file exists (JS, CSS, images) → return it
   - If not (SPA routes like `/board`, `/agents`) → return `index.html`
4. CORS headers: scoped to same-origin only (no `Access-Control-Allow-Origin: *`)

### Development Mode (`bun run dev`)
1. Bun spawns Vite dev server as a child process on port 5173
2. Bun waits for Vite to be ready (poll `localhost:5173` until 200)
3. Bun listens on port 3000
4. All `/api/*` requests → Bun handlers directly
5. All other requests → proxied to `localhost:5173` (Vite handles HMR, React dev mode)
6. On Bun shutdown → kill Vite child process

### Static File Resolution Order
1. Exact file match in `dist/` → serve with correct MIME type
2. Path is `/` or has no extension → serve `dist/index.html`
3. Not found → 404

### Scripts (root `package.json`)
- `"start": "bun run packages/web/src/index.ts"` — production
- `"dev": "bun run packages/web/src/index.ts --dev"` — development with Vite HMR
- Remove `"web"` and `"web:ui"` scripts (replaced by `start` / `dev`)
