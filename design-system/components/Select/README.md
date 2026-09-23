# Select

A native `<select>` in the shared control styling, with a chevron that flips while it has focus and an optional leading icon.

- Pass `<option>` children and the usual select props. `icon` adds a leading icon (filters use `FilterIcon`, `AgentsIcon`, `ProjectsIcon`).
- `selectSize`: `md` (the default) or `sm` for toolbars. Set the width with `wrapperClassName` (e.g. `w-40`).
- Make the empty option "All …" for filters: "All statuses", "All agents", "All projects".
- `error` behaves as in Input.
