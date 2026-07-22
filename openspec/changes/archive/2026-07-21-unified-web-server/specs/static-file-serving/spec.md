## Static File Serving

### Supported File Types
- HTML (`text/html`)
- JavaScript (`text/javascript`)
- CSS (`text/css`)
- SVG (`image/svg+xml`)
- PNG/JPEG/GIF/WebP (standard image types)
- JSON (`application/json`)
- Font files (woff2, woff, ttf)

### MIME Type Resolution
Bun's `Bun.file()` auto-detects MIME types from file extensions. No custom MIME mapping needed.

### Cache Headers
- `dist/index.html`: `Cache-Control: no-cache` (always fresh)
- `dist/assets/*`: `Cache-Control: public, max-age=31536000, immutable` (content-hashed filenames)
- Other static files: `Cache-Control: public, max-age=86400`

### SPA Fallback
Any request that:
- Is not `/api/*`
- Does not match an existing file in `dist/`
SHOULD return `dist/index.html` (for client-side routing).

### Production Build Dependency
The web-ui must be built before starting in production mode:
```bash
bun run --cwd packages/web-ui build
bun run start
```

Or as a combined script:
```bash
"start": "bun run --cwd packages/web-ui build && bun run packages/web/src/index.ts"
```
