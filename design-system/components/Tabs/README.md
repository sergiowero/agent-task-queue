# Tabs

Underline tabs with a sliding `primary` indicator and optional icons and counts.

- Supply `value`, `onChange`, `items` (`{ value, label, icon?, count? }`) and a `label` for the tab list.
- The selected tab is in `text` with a `primary` icon, and its count pill tints to `primary/10`.
- Put a `border-b border-border` on the list (via `className`) so the 2px indicator sits on a rule, then render the panel with `role="tabpanel"` below it.
- Use it to switch between views of one object, like a task's Conversation and History.
