# Tooltip

A small dark label that appears after 350ms of hover or keyboard focus, rendered in a portal and flipped to stay on screen.

- Wrap exactly one element that accepts a ref and mouse/focus handlers. Wrap non-interactive children (a Badge) in a `span`.
- `content` is a few words. `side` is `top` (the default), `bottom`, `left` or `right`. `delay` sets the hover delay (the collapsed sidebar uses 100ms).
- It uses a `text` fill with `surface` text, `rounded-md` and `shadow-lg`, and scales in from its anchor side. It hides on scroll, resize and pointer down.
- IconButton, CopyButton and icon-only segments already include one. Don't put essential information in a tooltip alone.
