# Research report style guide

How to write and style the HTML reports in `research/`. Every report opens on its own from disk
(double-click it, no server, no sibling files), in light and dark themes, from phone width up.
The look reuses the AgentQ portal's tokens (`design-system/README.md`,
`packages/web-ui/src/index.css`), so reports read as part of the product.

## Files

| Path | What it is |
|------|------------|
| `research/<YYYY-MM-DD>-<slug>.html` | A report. Date first so the folder sorts chronologically |
| `research/templates/report-template.html` | Blank skeleton with every component. Copy it to start a report |
| `research/assets/report.src.css` | Source stylesheet: tokens, base and every `r-*` component. Edit this one |
| `research/assets/tailwind.config.js` | Tailwind config: token colors, fonts, the safelist, and which files are scanned |
| `research/assets/report.css` | Compiled, minified CSS (generated; do not edit by hand) |
| `research/assets/report.js` | Theme toggle, table-of-contents highlight, collapsed TOC on phones |
| `research/build.ts` | Compiles the CSS and inlines CSS + JS into every report |

## Workflow

1. Copy the template: `cp research/templates/report-template.html research/2026-10-01-my-topic.html`.
2. Fix the asset paths in the copy from `../assets/` to `assets/` (the template sits one folder down).
   This only matters while you draft; the build inlines everything.
3. Write the content with the `r-*` components below.
4. Build from the repo root:

   ```bash
   bun run research:build
   ```

   It compiles `report.src.css` with the Tailwind CLI installed in `packages/web-ui` (run `bun install`
   first on a fresh clone), then replaces the blocks between `<!-- report-css:start -->` /
   `<!-- report-css:end -->` and `<!-- report-js:start -->` / `<!-- report-js:end -->` in every
   `research/**/*.html` with an inline `<style>` and `<script>`. It is safe to run again; files that did
   not change are left alone.
5. Open the file in a browser. Commit the report and the regenerated `assets/report.css`.

Keep both marker pairs in every report. Without them the build cannot inline, and the report only
works next to `assets/`.

### Offline behavior

Everything the page needs is inline. The only network request is the Google Fonts stylesheet (Inter
and JetBrains Mono). Offline, the text falls back to the system UI and monospace faces, and the layout
does not change.

### When you need a class the build does not have

Components (`r-*`) sit outside Tailwind's `@layer`, so they are always emitted. Utilities are
tree-shaken: only the classes some report uses, plus the safelist in `tailwind.config.js` (grid
columns, gaps, spacing, display, tone colors, text sizes, widths), end up in the CSS. The build scans
every report, so a new utility shows up after `bun run research:build`. If a pattern keeps coming back,
turn it into an `r-*` component in `report.src.css` instead of repeating utilities.

## Page anatomy

```
.r-page                       outer wrapper; owns the 16px (24px from 640px) side gutter
  header.r-header             brand bar + theme toggle, eyebrow, h1, lead, meta row
  .r-shell                    one column; from 1024px, a 220px sticky TOC + content
    nav.r-toc > details       table of contents (collapsed on phones, always open on desktop)
    main.r-main               sections, 72px apart
      section.r-section#id    one topic; the id is what the TOC links to
        .r-section__head      eyebrow + h2 + lead
      footer.r-footer         date, commit, where the styles live
```

Order a report the way a reader decides: the verdict first, then the evidence, then the proposal, then
the plan, then the appendix. The first screen must answer the question on its own.

## Voice

- Write in the reader's language (Spanish reports stay fully in Spanish; code, paths, statuses and
  tool names stay as they are spelled in the code).
- Sentence case for every heading, label and chip. No emoji, no exclamation marks.
- The h1 states the conclusion, not the topic: "Menos puertas humanas, más evidencia de agentes",
  not "Análisis del flujo".
- `<title>` is the report's name in two to four words ("Auditoría del flujo AgentQ"), with no
  explainer after a dash or colon. The explanation goes in `<meta name="description">`.
- Every finding cites the code that proves it with an `r-ref` (`path/to/file.ts:123`). No claim
  without a reference or a number.
- Put branches, paths, ids, statuses and commands in `<code>`, never in quotes.
- Numbers in tables and stats use `tabular-nums` (`r-num`, `r-stat__value` already do).

## Color

Tokens are RGB channel triples on `:root` (light), redefined under
`@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])` and again under
`:root[data-theme="dark"]`, so the OS setting and the toggle both work.

| Token | Use |
|-------|-----|
| `canvas` | Page ground |
| `surface` | Cards, tables, panels |
| `surface-secondary`, `surface-tertiary` | Wells, table headers, inline code, stat tiles |
| `border`, `border-light`, `border-strong` | Hairlines, inner dividers, emphasis |
| `text`, `text-secondary`, `text-muted` | Body, secondary copy, metadata |
| `primary` (indigo) | The one thing the page is for: the "do this first" callout, the active TOC item, links |
| `danger`, `warning`, `success`, `info`, `accent`, `neutral` | Semantic tones only (see below) |

Tones are applied with a class, never with ad hoc colors: add `r-tone-<name>` to any toned component
(`r-chip`, `r-callout`, `r-stat`, a legend item). The component reads `--tone` and `--tone-text`.

| Tone | Means |
|------|-------|
| `danger` | High severity, broken, missing |
| `warning` | Medium severity, partial, waits on a human |
| `success` | Works, target state, automated check |
| `info` | Agent work, neutral information |
| `accent` | New things, critics / second-opinion agents |
| `neutral` | Low severity, sizes, metadata |
| `primary` | Recommendation, principle, default choice |

Never let hue be the only signal: a chip always carries a word ("Alta", "Parcial", "Nuevo").

## Type

- Inter for everything, with `cv02 cv03 cv04 cv11`; JetBrains Mono for code, paths and ids.
- Scale: `r-h1` 28–40px/700, `r-h2` 24px/600, `r-h3` 17px/600, `r-lead` 17px, body 15px,
  `r-small` 13px, `r-eyebrow` 11px uppercase with +0.08em tracking, chips 11.5px.
- Headings use `text-wrap: balance`; running text stays under ~72 characters (`r-prose`).

## Components

All classes live in `research/assets/report.src.css`.

### Header

```html
<header class="r-header">
  <div class="r-header__bar">
    <span class="r-brand"><span class="r-brand__mark">AQ</span>AgentQ · Investigación</span>
    <button type="button" class="r-btn" data-theme-toggle id="theme-toggle">Tema oscuro</button>
  </div>
  <p class="r-eyebrow">Auditoría de flujo · 23 sep 2026</p>
  <h1 class="r-h1">The conclusion as a headline</h1>
  <p class="r-lead">What was analyzed and what the reader will find.</p>
  <div class="r-meta"><span><b>Commit</b> <code>2859af1</code></span></div>
</header>
```

`report.js` finds `[data-theme-toggle]`, labels it and remembers the choice in `localStorage` (wrapped
in try/catch, so blocked storage only loses the memory).

### Verdict and stats

`r-verdict` is the page's one lifted block (the only `shadow-md`). Two columns from 860px: the answer
on the left, `r-stats` (2×N tiles) and a `r-callout r-tone-primary` on the right. Use stat tiles only
when the numbers are the point.

```html
<div class="r-stat r-tone-warning">
  <span class="r-stat__value">3–7</span>
  <span class="r-stat__label">clics humanos por tarea hoy</span>
</div>
```

### Sections

```html
<section class="r-section" id="hallazgos">
  <div class="r-section__head">
    <p class="r-eyebrow">Diagnóstico</p>
    <h2 class="r-h2">Hallazgos</h2>
    <p class="r-lead">One sentence on what the section holds.</p>
  </div>
  …
</section>
```

Add a matching `<li><a href="#hallazgos">…</a></li>` to the TOC; `report.js` highlights it while the
section is on screen.

### Findings

A bordered list with dividers, not a stack of cards. The id (`F1`…) lets other sections and the
appendix point at it.

```html
<div class="r-findings">
  <article class="r-finding">
    <div class="r-finding__head">
      <span class="r-finding__id">F1</span><span class="r-chip r-tone-danger">Alta</span>
      <span class="r-finding__title">Short statement of the defect</span>
    </div>
    <p class="r-finding__body">What happens, why it matters, what proves it.</p>
    <span class="r-ref">packages/shared/src/workflow.ts:344</span>
  </article>
</div>
```

Severity: `danger` = Alta, `warning` = Media, `neutral` = Baja.

### Chips

`<span class="r-chip r-tone-success">Bien</span>` has a status dot; add `r-chip--plain` to drop the
dot for labels that are not states (sizes, "Nuevo", "Por defecto", versions).

### Callouts

```html
<div class="r-callout r-tone-warning">
  <span class="r-callout__title">Title</span>
  <p class="r-small" style="margin: 0">Body.</p>
</div>
```

Use them for a principle, a warning, or a short fact that must not be missed. Lay several out with
`r-grid-2` / `r-grid-3` (one column on phones, two or three from 720px).

### Tables

Always wrap: `<div class="r-table-wrap"><table class="r-table">…</table></div>`. The wrapper scrolls
sideways on narrow screens so the page never does. `r-num` right-aligns numbers; `r-nowrap` keeps a
short cell on one line.

### Code

```html
<p class="r-pre-label">packages/shared/src/policy.ts (nuevo)</p>
<pre class="r-pre"><code>…</code></pre>
```

Escape `<` as `&lt;`. Optional hand highlighting with spans: `k` keyword, `t` type, `s` string,
`c` comment. Keep blocks to the lines that make the point.

### Flow diagrams

A wrapping row of steps; the actor decides the color, so a reader sees at a glance who does what.

```html
<div class="r-lane">
  <div class="r-legend">
    <span class="r-tone-info"><i></i>Agente</span>
    <span class="r-tone-warning"><i></i>Puerta humana</span>
  </div>
  <div class="r-flow" role="list" aria-label="Flujo actual">
    <div class="r-step r-step--agent" role="listitem">
      <span class="r-step__actor">Planner</span><span class="r-step__name">Plan</span>
      <span class="r-step__note">submit_plan</span>
    </div>
    <span class="r-arrow" aria-hidden="true">→</span>
    <div class="r-step r-step--human" role="listitem">…</div>
  </div>
</div>
```

| Modifier | Actor | Tone |
|----------|-------|------|
| `r-step--agent` | An agent doing the work | info |
| `r-step--critic` | A reviewing / second-opinion agent | accent |
| `r-step--check` | Deterministic, automated | success |
| `r-step--human` | A human gate (dashed border: it is a wait) | warning |

### Roadmap

`r-phase` (a phase with `r-phase__head` and a size chip) holds `r-task` items. Each task has an id,
a title, a size chip (S/M/L), the files it touches in an `r-ref`, and its acceptance criteria as a
list, so it can be pasted into an AgentQ task as is.

### Cards and collapsibles

`r-card` for a self-contained group (add `r-card--flat` for a quieter well). `r-details` with
`r-details__body` for long material a reader may skip. Not every block needs a card: sections, tables
and findings already separate themselves.

## Layout rules

- The gutter lives on `.r-page` only. Never add side padding to sections.
- Stack with `gap` (`r-stack`, `r-stack-lg`, `r-grid-*`), not margins between siblings.
- Only tables, code and diagrams may be wider than the screen, each in its own scrolling wrapper.
- Motion is limited to hover states and smooth scrolling, and `prefers-reduced-motion` turns it off.
- Content is visible at rest: nothing waits on scroll to appear.

## Checklist before committing a report

- [ ] `<title>` is a two-to-four-word name; the description explains it.
- [ ] The first screen answers the question.
- [ ] Every finding has a severity chip and a code reference.
- [ ] Every TOC link has a section with that id.
- [ ] `bun run research:build` ran after the last edit, and the file opens by double-click.
- [ ] Checked in light and dark, and at phone width.
