# Field

The standard form row: a label, one control and an optional hint, wired together with a generated id.

- Supply `label` and exactly one control as the child. The control receives the generated `id` unless it already has one.
- `required` adds a danger asterisk. `icon` adds a 14px muted icon before the label.
- `hint` is one short sentence under the control: "Higher runs first", "How often it checks the queue." Set `hintTone="warning"` (or `"danger"`) when the chosen value is risky, as the runner form does for "Full access".
- `aside` puts a small action at the right of the label row.
- Stack fields with `space-y-4`, and put related short fields side by side in a two-column grid.
