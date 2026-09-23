# Design system build

`design-system/` is AgentQ's design system, extracted from `packages/web-ui`:

- `README.md` is the brand book: voice, color, type, layout, motion, states, icons, logo.
- `tokens.json` holds the tokens: colors per theme, type, spacing, radii, shadows, sizes and z-layers.
- `components/<Name>/` has a `README.md` (guidelines) and a `preview.html` (a live card) per component, plus the cover in `components/Cover/`.
- `components/bundle.js` is the portal's components as one classic script that assigns `window.AgentQ`. It reads React 18 from `window.React` and `window.ReactDOM`.
- `components/bundle.css` is the portal's compiled Tailwind. Its color reads are rewritten to use the full colors that `tokens.css` declares.
- `components/index.d.ts` holds the component props, for reference.
- `assets/Logos/` holds the app mark and the favicon.

## Rebuild

After changing components or styles in `packages/web-ui`, run this from the repo root:

```bash
bun run design-system:build
```

It regenerates `components/bundle.js` and `components/bundle.css`. It also exits non-zero if `tokens.json` no longer matches the colors in `packages/web-ui/src/index.css`. When that happens, update the listed tokens by hand and keep their usage notes.

To add a component:

1. Export it from `scripts/entry.ts` and add its name to `COMPONENTS` in `scripts/build.ts`.
2. Write `components/<Name>/README.md` and `components/<Name>/preview.html`, starting the preview with its `<!-- @dsCard group="…" height=N -->` marker line.
3. Rebuild.
