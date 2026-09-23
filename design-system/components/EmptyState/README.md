# EmptyState

The centered placeholder for a list or page with nothing in it yet: an icon tile, a title, a sentence and an optional action.

- Supply `title` ("No runners yet") and usually `description` (what will appear and when). `icon` defaults to `EmptyIcon`; use the section's own icon instead.
- `action` is usually the primary Button that creates the first item ("New runner").
- `compact` shrinks it for panels and tabs (40px padding instead of 80px).
- Reuse it for load errors with `ErrorIcon`, "Couldn't load this task" and a secondary "Try again" button.
