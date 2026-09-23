# CopyButton

An icon button that copies a value to the clipboard and morphs into a green check for 1.5 seconds.

- Supply `value` (the text to copy) and a `label` that names it: "Copy branch", "Copy worktree path", "Copy command".
- `size`: `xs` (24px) beside inline mono text, `sm` (32px) in headers and panels.
- It stops click propagation, so it works inside clickable cards. On failure it shows the toast "Could not copy to clipboard".
- Put it right after the `mono` text it copies.
