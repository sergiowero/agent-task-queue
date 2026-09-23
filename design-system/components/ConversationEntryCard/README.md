# ConversationEntryCard

One message in a task's conversation: a tone-tinted type icon, the author, a type badge, a relative time and the message rendered as Markdown.

- Supply `entry`: `{ authorName, timestamp, message, messageType }`. The type is one of `plan` (accent), `code` (info), `review` (warning), `merge` (success), `user` (primary), `agent` or `system` (neutral).
- Messages sit in a `.card`. `system` entries skip the card and render in `text-muted`, so they read as annotations.
- The time shows as relative ("42 min. ago") with the exact time in its `title`.
- Stack entries with `space-y-5`.
