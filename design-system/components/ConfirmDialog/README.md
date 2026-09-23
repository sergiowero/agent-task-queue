# ConfirmDialog

A small yes/no Modal that runs an async action with a loading state, e.g. before deleting or canceling something.

- Supply `title` (a question: "Delete runner?"), `message` (what happens, with the object's name in `font-medium text-text`), `onConfirm` and `onClose`.
- `tone`: `danger` (the default: trash icon, danger button), `warning` or `primary`. `confirmLabel` defaults to "Delete"; name the action instead ("Delete runner", "Cancel task"). `cancelLabel` defaults to "Cancel"; change it when that's ambiguous ("Keep task").
- `onConfirm` may return a promise. The dialog closes when it resolves and stays open for a retry if it rejects (report the error with a toast).
- The confirm button gets autofocus, and dismissal is blocked while pending.
