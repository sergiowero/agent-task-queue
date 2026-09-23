# Toggle

A switch for a boolean setting, with an optional label, description and icon on the left.

- It is controlled: supply `checked` and `onChange(checked)`. `label` names the setting ("Requires planning"), and `description` explains the consequence in one line ("An agent writes a plan for your review before coding.").
- The whole row is clickable. The switch is a 36×20 pill: `primary` when on, `border-strong` when off, with a white knob that springs across.
- Use a Toggle for settings that apply right away or on save. For choosing between named modes, use a SegmentedControl.
