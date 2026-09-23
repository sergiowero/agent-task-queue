# SegmentedControl

A single choice among two to four options, drawn as a pill track with a sliding thumb.

- Supply `value`, `onChange(value, event)`, `options` (`{ value, label, icon?, iconOnly? }`) and a `label` for the radio group.
- `size`: `md` (32px segments, 13px) or `sm` (28px, 12px). `fullWidth` stretches the segments.
- `iconOnly` options hide their text and show it as a tooltip. The theme switch does this with the Light, Dark and System icons.
- Use it for modes and ranges ("Safe" / "Full access", 25 / 50 / 100 events). For navigating between content panels, use Tabs.
