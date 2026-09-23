# Button

The portal's text button, in six variants and three sizes, with optional leading and trailing icons and a loading state.

- `variant`: `primary` (default) is the one main action of a view, e.g. "New task" or "Approve plan". `secondary` is a bordered neutral for everything else ("Try again", "Browse"). `ghost` is for low-emphasis actions in toolbars and dialogs ("Cancel", "Clear filters"). `subtle` is a primary-tinted soft action. `danger` confirms something destructive, and `danger-ghost` offers a destructive action without shouting ("Cancel task").
- `size`: `sm` is `h-8`/12px (toolbars, inline), `md` is `h-9`/14px (the default), `lg` is `h-10`/14px with `rounded-xl`.
- `icon`: a leading icon from `AgentQ.Icons`; it is replaced by a spinner while `loading`. `iconRight` is a trailing icon that nudges 2px right on hover. Use it for "go" actions (`ChevronRightIcon`).
- `loading` disables the button and sets `aria-busy`. Keep the label, don't swap it for "Loading…".
- All native button props pass through; `type` defaults to `"button"`.
- Put one primary per view, placed last in a row of actions. Put the dismiss action before the confirm action.
- `buttonVariants` and `buttonBase` are exported, so a link can look like a button.
