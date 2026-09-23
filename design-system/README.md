AgentQ is a local task queue for coding agents. The portal is a calm, dense, neutral workspace: zinc greys on a near-white `canvas`, one indigo `primary`, and six semantic tones for workflow state. It ships in a light and a dark theme with the same structure, so every rule below holds in both.

## Voice and content

- Write in sentence case everywhere: page titles, buttons, labels, statuses ("Plan review", "Changes requested", "Ready for code").
- Lead buttons with the verb and name the object when it isn't obvious: "New task", "Create project", "Approve plan", "Delete runner", "Try again". Use a bare "Cancel", "Save" or "Delete" only inside a dialog that already names the object.
- Phrase confirmations as a question in the title and say what happens in the body: "Delete runner?" / "Running jobs are killed and their tasks released back to the queue." Add "This cannot be undone." when it can't. Relabel the dismiss button if "Cancel" would be ambiguous: "Cancel task" beside "Keep task".
- Give empty states a "No … yet" title and one sentence about what will appear and when: "No jobs yet" / "Jobs appear here as soon as the runner claims a task."
- Keep toasts to object + past participle: "Task created", "Project deleted". Errors say what failed, plainly: "Couldn't load this task", "Could not copy to clipboard".
- Page descriptions are one sentence that says what the page holds: "What happened across all tasks, newest first."
- Address the reader as "you" ("An agent writes a plan for your review before coding."). Agents are "agents", runtimes are "runners", and tools are named in lowercase as their commands are spelled: claude, codex, opencode, gemini.
- No emoji and no exclamation marks. The one exception is the transient "Copied!" tooltip.
- The product is **AgentQ**, with capital A and Q. Its tagline is lowercase: "your 100x engineer tool".
- Set branch names, paths, ids and commands in `mono` (`font-mono text-xs`), never in quotes.

## Color

- Build every screen from the neutral ramp: `canvas` for the app ground; `surface` for panels, cards and inputs; `surface-elevated` for modals, drawers, toasts and board cards; `surface-secondary` and `surface-tertiary` for hover fills, wells and chips.
- Set copy in `text`, secondary copy in `text-secondary` and metadata in `text-muted`. Keep `text-muted` to hints, timestamps and placeholders on `surface`: it drops under 4.5:1 on the grey surfaces and on the light `canvas`.
- Draw hairlines with `border`, internal dividers with `border-light`, and hover or unchecked-control edges with `border-strong`.
- Spend `primary` (indigo) on the one thing the page is for: the primary button, the active nav item, the selected card, the focus ring, checked controls. Keep it rare so it stays loud.
- Every tone (`primary`, `danger`, `success`, `warning`, `info`, `accent`) comes in four shades. Use the solid shade (`primary`) for fills and borders, `-hover` for the pressed/hover fill, `-fg` for text on the solid fill, and `-text` for colored text on neutral grounds. In Tailwind, `text-primary` already resolves to `primary-text`.
- Use soft tints for status. A chip is `bg-{tone}/10` + `text-{tone}` + a `ring-{tone}/20` inset ring. An alert is `bg-{tone}/[0.06]` + `border-{tone}/25`. Never put `-text` on a solid fill.
- Map workflow state to tone through `TASK_STATUS` in `lib/status.ts`, never ad hoc. `accent` = planning, `info` = ready and coding, `warning` = anything waiting on review (plus merging), `success` = approved, merged and complete, `danger` = changes requested and canceled, `neutral` = requested and not started.
- Board columns follow the same map: Pending is neutral, In progress is info, Needs review is warning and Done is success.
- Tool tones are fixed: claude = `accent`, codex = `info`, opencode = `success`, gemini = `warning`, custom = neutral. Priority tones: P0 neutral, P1 `info`, P2 `warning`, P3+ `danger`.
- Always pair a status color with its label and icon (StatusBadge does this). Hue is never the only signal.
- Known contrast gaps kept from the source: white on light `success` (3.3:1) and `warning` (3.19:1), and white on dark `info`, `accent` and `primary` hover fills, all fall below 4.5:1. Put only large or bold text on those fills, or use the tinted chip instead.
- Scrims use `overlay` plus a 2–3px backdrop blur. The main column gets a 7% `primary` radial glow at the top (`ellipse 60% 100% at 50% 0%`), about 288px tall.

## Typography

- Set everything in Inter (`sans`) with the stylistic sets `cv02 cv03 cv04 cv11` enabled on `body`, antialiased. Use JetBrains Mono (`mono`) for code, branches, paths and ids. Both load from Google Fonts: Inter at 400/500/600/700, JetBrains Mono at 400/500.
- The scale is small and tight. Use `page-title` (17px/600) for the PageHeader, `dialog-title` (16px/600) for modals and empty states, `body` (14px) for UI copy, `label` (13px/500) for form labels and compact controls, `caption` (12px) for hints and timestamps, `badge` (11px/500) for chips, and `eyebrow` (11px/600, uppercase, +0.06em) for section micro-labels.
- Titles take `tracking-tight` (-0.025em). The only larger text is `stat` (18px/600), the value in a stat tile under an `eyebrow` label. Markdown headings are the exception.
- Emphasize with weight: 500 for interactive labels and card titles, 600 for headings and counts.
- Set counts and durations in `tabular-nums`.
- Render long-form agent text with `markdown` (14px, line-height 1.65): headings at 600 and -0.01em, links in `primary-text` with a 35% underline, and code blocks on `surface-secondary` with a `border` hairline, highlighted with the `hl-*` tokens.

## Space, layout and shape

- Use the 4px Tailwind scale (`space-*` tokens). The page gutter is `space-6` (24px), cards pad `space-3` (task card) or `space-4`, and inline rows gap `space-2`.
- The app shell is a sidebar plus a main column. The sidebar is `sidebar` (244px) wide, or `sidebar-collapsed` (68px) when collapsed, on `surface` at 60% with `backdrop-blur-xl` and a `border` right edge. Its nav groups (Work, Automation, Insights) carry `eyebrow` labels. The active item slides a `primary/10` pill with a 3px `primary` bar on its left edge.
- Every page opens with PageHeader: sticky, `h-16`, `surface` at 80% with blur, a `border` bottom, and an optional toolbar row under a `border-light` rule. Content scrolls inside PageBody.
- Control heights: `h-8` (sm), `h-9` (the default) and `h-10` (lg). Tabs are `h-11`, headers `h-16`.
- Radii grow with the object. `rounded-md` for tooltips and segments, `rounded-lg` for controls, `rounded-xl` for cards, wells and toasts, `rounded-2xl` for modals and board columns, and `rounded-full` for badges, pills, dots and switches. The Checkbox is `rounded-checkbox` (5px).
- Separate with 1px borders first and shadows second. Resting cards get `shadow-xs`, solid buttons `shadow-sm`, hovered cards `shadow-md`, tooltips and toasts `shadow-lg`, and modals and drawers `shadow-xl`. The primary button adds `shadow-glow` on hover.
- Solid buttons carry a faint top-down white sheen: `linear-gradient(180deg, rgb(255 255 255 / 0.12), transparent)`.
- Stack layers with the `z-*` tokens: header 20, sidebar 30, drawer 40, modal 50, tooltip 100.

## Motion

- Motion is quick and physical. Use `ease-out-expo` (`cubic-bezier(0.16, 1, 0.3, 1)`) for entrances and sliding indicators, `spring` (`cubic-bezier(0.34, 1.56, 0.64, 1)`) for small pops such as icons, the toggle knob and checkmarks, and ease-in for exits.
- Durations: 150ms for hover and press, 200ms for color and theme, 260ms for dialog scale-in, 300–320ms for sliding thumbs, drawers and page entrance, 360–380ms for list rise. Exits run at 160–200ms, and `useModal` waits 180ms before unmounting.
- Buttons press to `scale(0.97)` and icon buttons to `scale(0.9)`. Interactive cards lift 2px on hover and pick up a `primary/40` border.
- Stagger list entrances with `.stagger` and `--i`: 35ms per item, capped at 12 items.
- Live states pulse: a `pulse-ring` around the status dot for anything an agent is actively working on (planning, coding, reviewing, merging, running).
- Switch themes with a circular View Transitions reveal from the toggle. Without it, colors cross-fade over 300ms.
- `prefers-reduced-motion` collapses every animation and transition to 0.01ms. Only spinners keep turning.

## States

- **Hover:** secondary controls move to `border-strong` + `surface-secondary`, and ghost controls fill with `surface-secondary` (or `surface-tertiary/70` for icon buttons).
- **Focus:** show a 2px `primary/60` ring with a 2px `surface` offset on buttons, switches and checkboxes. Inputs switch their border to `primary/70` and add a 4px `primary/15` halo. Anything else falls back to a 2px `primary/70` outline. The 60% ring is under 3:1 on `surface` (2.8:1 light, 2.3:1 dark); that value comes from the source.
- **Error:** `border-danger/70` with a 4px `danger/15` halo, and the message in `caption` + `danger-text` under the field.
- **Selected:** `primary/10` fill, `primary` text and a `primary/15`–`/20` ring. A selected task card gets a `primary/50` border, a 2px `primary/20` ring and a 4% `primary` wash.
- **Disabled:** 50% opacity (40% for icon buttons) and no pointer events.
- **Loading:** buttons swap their leading icon for a spinner and disable themselves. Pages show Skeleton blocks shaped like the content.

## Iconography

- Icons are Lucide (lucide-react), 24px-grid stroke icons at stroke width 2, and they inherit `currentColor`. Import them only through the portal's vocabulary in `lib/icons.ts` (exposed here as `AgentQ.Icons`), so an action always gets the same glyph: `AddIcon`, `DeleteIcon`, `ApproveIcon`, `MergeIcon` and so on. See the Icons card for the full set.
- Sizes: 14px (`h-3.5`) in badges, sm buttons and meta rows; 16px (`h-4`) by default; 18px in nav items and md icon buttons; 20px in modal header wells; 24px at stroke 1.75 in empty states. The active nav icon thickens to 2.25.
- Icons next to text are `aria-hidden`. An icon-only control is always an IconButton with a `label`, which becomes both its accessible name and its tooltip.
- Put a feature icon in a tinted well: `rounded-xl` + `TONE_SOFT[tone]` (modal headers) or a `primary/15`→`accent/10` gradient well with a `primary/15` ring (page headers).

## Logo

- The mark is a rounded tile with the brand gradient, indigo `#6366f1` to violet `#a855f7` corner to corner, carrying three white queue lines of decreasing length. Use `agentq-mark.svg` in the app at 36px, with an indigo (`#6366f1`) drop shadow at 35% (`0 4px 12px`). Use `agentq-favicon.svg` (radius 8, gradient to `#8b5cf6`) only for the browser tab.
- There is no wordmark. Set "AgentQ" beside the mark in `brand-name` (Inter 15px bold, tight), with the tagline in 11px `text-muted` under it.
- Never recolor the tile, flatten the gradient, or change the line lengths.

## Building with the system

- In the repository, colors are RGB channel triples in `src/index.css` (`--primary: 79 70 229`). Tailwind reads them as `rgb(var(--primary) / <alpha-value>)` so opacity modifiers like `bg-primary/10` work in both themes. The dark theme switches on `[data-theme="dark"]` on `<html>`, set before first paint from `localStorage["agentq-theme"]` or the OS preference.
- In this system, `tokens.css` declares full colors, and `components/bundle.css` is the portal's compiled Tailwind with every `rgb(var(--x) / a)` rewritten to `color-mix()` over the same variables. Load `bundle.css` after `tokens.css` and every utility class from the portal works (`card`, `card-interactive`, `eyebrow`, `stagger`, `skeleton`, `markdown-content`).
- Compose class names with `cn()`: it filters falsy values and lets a later class override a conflicting earlier one.
- Reuse the tone maps (`TONE_SOFT`, `TONE_TEXT`, `TONE_DOT`, `TONE_BORDER`) instead of writing tone classes by hand.

## Not synced

- The `--ease-out` custom property is not a token, because the system has no motion family. It stays in `bundle.css`; its curves are listed under Motion.
- There are no font files. Inter and JetBrains Mono load from Google Fonts, via `bundle.css` and the app's `index.css`.
- Icons are not uploaded as SVG files. The Lucide vocabulary ships inside `bundle.js` as `AgentQ.Icons`.
- These are not built as cards: Layout (the app shell; it needs the router), ThemeToggle (it needs ThemeContext), and the page-level modals and forms: CreateTaskModal, EditProjectModal, RunnerModal, DeleteTaskModal, BulkDeleteModal, EditableField, ErrorBoundary and LoadingSkeleton. All live in `packages/web-ui/src/components/`.
- The bundle runs the components on React 18 (the app uses 19). Tooltip can't forward a trigger's own `ref` there, and PageHeader's back button follows its link instead of calling react-router.
