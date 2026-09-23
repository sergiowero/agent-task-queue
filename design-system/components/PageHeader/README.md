# PageHeader

The sticky top bar of every page: an optional back button, an icon well, a title with a count, a one-line description, actions and an optional toolbar row.

- Supply `title` (`page-title`, 17px/600). Add `icon` (shown in a `primary/15`→`accent/10` gradient well from `sm` up), `description` (one sentence, from `md` up), `meta` (usually a CountPill) and `actions` (right-aligned, primary button last).
- `back`: `{ to, label }` renders a secondary IconButton before the title ("Back to board").
- `toolbar` renders a second row under a `border-light` rule for search and filters: `sm` Inputs and Selects with fixed widths.
- Follow it with `PageBody`, the scrolling content area with the 24px gutter.
