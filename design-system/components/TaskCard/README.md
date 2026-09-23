# TaskCard

The board's card for one task: its title, priority, branch, status, assigned agent, optional selection and a hover-revealed delete.

- Supply `task` (the API `Task`: `title`, `priority`, `recommendedBranch`, `status`, `assignedAgent`) and `onClick`. It behaves as a link: focusable, and Enter opens it.
- `onToggleSelect` + `selected` add a Checkbox for bulk actions. The selected card gets a `primary/50` border, a 2px `primary/20` ring and a 4% `primary` wash.
- `onDelete` adds a danger IconButton that appears on hover or focus (always shown on touch).
- It is a `.card-interactive` on `surface-elevated` with 12px padding, and it lifts on hover. Place it in a board column: `rounded-2xl`, `border-light`, `surface-secondary/60`, with an `h-12` header holding the tone well, a 13px/600 label and a CountPill.
