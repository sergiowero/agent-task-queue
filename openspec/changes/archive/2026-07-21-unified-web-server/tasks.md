## 1. Add Static File Serving to Bun Server

- [x] 1.1 Add `--dev` flag parsing to `packages/web/src/index.ts`
- [x] 1.2 Add static file serving logic for `packages/web-ui/dist/`
- [x] 1.3 Add SPA fallback (non-API, non-file requests → `index.html`)
- [x] 1.4 Set proper cache headers for assets vs index.html
- [x] 1.5 Move static file handling before the `return errorResponse("not found", 404)` fallback

## 2. Add Dev Mode with Vite Proxy

- [x] 2.1 Add Vite child process spawn on `--dev` flag
- [x] 2.2 Add health-check polling loop (wait for Vite to be ready)
- [x] 2.3 Add proxy logic: non-API requests → forward to `localhost:5173`
- [x] 2.4 Handle WebSocket upgrade for Vite HMR (client port configured in vite.config.ts)
- [x] 2.5 Clean up Vite process on Bun shutdown

## 3. Update Configuration and Scripts

- [x] 3.1 Update root `package.json`: add `start` and `dev` scripts, remove `web` and `web:ui`
- [x] 3.2 Remove `/api` proxy from `packages/web-ui/vite.config.ts`
- [x] 3.3 Remove `Access-Control-Allow-Origin: *` from API responses (conditional on `isDev`)
- [x] 3.4 Add build step to production `start` script (build web-ui before serving)

## 4. Verify and Document

- [x] 4.1 Verify production mode: build web-ui, start Bun, test all API + UI routes
- [x] 4.2 Verify dev mode: `bun run dev`, confirm HMR works on file changes
- [x] 4.3 Verify SSE still works in both modes (unchanged `/api/events` handler)
- [x] 4.4 Update README references to new unified commands

## 5. Fix edge cases found during verification

- [x] 5.1 Unmatched `/api/*` paths now return 404 instead of being proxied to Vite in dev mode
- [x] 5.2 SSE URL changed from hardcoded `http://localhost:3000/api/events` to relative `/api/events`
