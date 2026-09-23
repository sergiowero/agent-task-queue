# IconButton

A square icon-only button whose `label` becomes both its accessible name and its tooltip.

- Supply `icon` and `label`, which are required. Write the label as the action: "Edit title", "Delete task", "Back to board".
- `variant`: `ghost` (default) is a muted icon that fills on hover. `secondary` is bordered, for header back buttons. `primary` is a solid fill. `danger` is muted until hovered, then red.
- `size`: `xs` 24px (inside cards and inputs), `sm` 32px (the default), `md` 36px (matches md buttons).
- `active` gives the pressed look (`primary/10` fill, `primary` icon) for toggles and sets `aria-pressed`.
- `tooltip={false}` turns the tooltip off (e.g. a modal's close button). `tooltipSide` places it.
- Reveal destructive icon buttons on card hover (`opacity-0 group-hover:opacity-100`), and keep them visible on touch (`[@media(hover:none)]:opacity-100`).
