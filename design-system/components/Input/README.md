# Input

A single-line text field with the shared control styling, an optional leading icon, a trailing slot and an inline error.

- Pass the usual input props (`value`, `onChange`, `placeholder`, `type`…). Name it with a `Field` label or `aria-label`.
- `icon`: a leading 16px icon that turns `primary` while the field has focus (search uses `SearchIcon`).
- `trailing`: an element pinned inside the right edge, usually an `xs` IconButton such as "Clear search".
- `error`: a message shown under the field in `caption` + danger. It also sets a danger border and halo and `aria-invalid`. Say what's wrong and how to fix it: "Must be a UUID (8-4-4-4-12 hex digits)."
- `inputSize`: `md` (`h-9`, the default) or `sm` (`h-8`, 13px) for toolbars.
- Placeholders show an example value, not an instruction: "My project", "/path/to/repo", "feature/my-change". Add `font-mono` for paths and branches.
