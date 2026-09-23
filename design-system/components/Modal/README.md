# Modal

A centered dialog with an optional tinted icon, a title, a description, a scrolling body and a footer, with a focus trap, Escape and backdrop dismissal.

- Supply `title` and `onClose`. Add `description` (one sentence), `icon` + `iconTone` (defaults to `primary`), `size` (`sm` 448px, `md` 512px (the default), `lg` 672px, `xl` 896px) and `children` for the body.
- `footer` holds the buttons, right-aligned: dismiss first, then the primary action. `footerStart` puts a destructive action at the left.
- `onSubmit` wraps the body and footer in a form so Enter submits.
- Close it with `useModal(onClose)`: spread `modal.props` on the Modal and call `modal.close` from Cancel or after a successful save, so the 180ms exit animation plays. Set `dismissible={false}` while saving.
- The same file exports `Drawer`, a right-side sheet (`max-w-4xl`) with a 64px header for detail views. It uses the same `useModal` contract.
