# Badge

A small rounded-full chip for a short label in one of seven tones, optionally with an icon or a live dot.

- Supply `children` (one or two words) and `tone`: `neutral`, `primary`, `info`, `success`, `warning`, `danger` or `accent`. Pick the tone from the shared maps: `priorityTone(p)` for P0–P3, `TOOL_TONE[tool]` for runners.
- `size`: `sm` (20px tall, 11px text, the default) or `md` (24px, 12px).
- `icon` adds a leading icon. `dot` shows a status dot instead, and `pulse` rings the dot for live states.
- A badge is `{tone}/10` fill + `text-{tone}` + an inset `{tone}/20` ring. Don't put badges on solid tone fills.
- `Dot` is exported on its own for tone dots in lists.
