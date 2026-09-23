# Alert

An inline message box in one of four tones for errors, warnings, notes and confirmations inside a page or form.

- Supply `tone` (`info` default, `success`, `warning`, `danger`), and `children` and/or a `title`. It picks a matching icon unless you pass `icon`.
- `action` puts an element on the right, usually a small ghost Button.
- `danger` alerts get `role="alert"`, the rest `role="status"`. It slides in with `slide-down`.
- Use it for persistent, contextual problems like a runner's last error or a form's save error. Use a toast for transient confirmations.
