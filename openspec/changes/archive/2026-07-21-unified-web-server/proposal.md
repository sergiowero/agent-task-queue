## Why

Currently the web API and web UI run as two separate processes on different ports — Bun (`packages/web`) on :3000 and Vite (`packages/web-ui`) on :5173. In development this means running two terminals. In production it requires either a reverse proxy (nginx) or serving static files from a separate process. This adds unnecessary operational complexity for a single-user desktop tool.

## What Changes

- `packages/web` (Bun) will serve the built web UI static files (`packages/web-ui/dist/`) alongside the API
- In development, Bun will proxy non-API requests to Vite's dev server (port 5173) for HMR
- A single `bun run start` command will start both servers, or for production, just Bun on one port
- The Vite proxy config will be removed since Bun handles routing
- CORS headers can be scoped down since API and UI are on the same origin

## Capabilities

### New Capabilities

- `unified-dev-server`: Single development command that starts both API and UI with hot reload
- `static-file-serving`: Bun serves compiled UI assets (`index.html`, JS, CSS, images) in production mode

### Modified Capabilities

- `web-portal`: No longer needs a reverse proxy or separate production server for UI assets
- `packages/web`: Gains static file serving and optional Vite proxy middleware

## Impact

- `packages/web/src/index.ts`: Add static file serving logic + dev-mode Vite proxy
- `packages/web/package.json`: New `start` script, optional `dev` script
- `packages/web-ui/vite.config.ts`: Remove `/api` proxy (no longer needed since Bun handles routing)
- `package.json` root: Simplify scripts — `web` becomes the single entry point
- `packages/web-ui/`: No structural changes, just build output consumed by Bun
