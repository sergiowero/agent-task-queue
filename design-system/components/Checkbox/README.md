# Checkbox

A custom checkbox with an animated check and an indeterminate state, meant to sit inside clickable cards and column headers.

- It is controlled: supply `checked` and `onChange(checked)`. `label` is required and is the accessible name. Pass `showLabel` to also show it as text.
- `indeterminate` shows a bar for "some selected". Board column headers use it for select-all.
- It stops click propagation, so toggling it never opens the card it sits on.
- Unchecked is a `border-strong` outline, checked is a solid `primary` fill with a white check, and the corner radius is 5px.
