## Why

Task conversation entries currently render as plain text with only whitespace preservation. Agents and users need to format responses with code blocks, lists, bold/italic text, and links to communicate effectively. Without markdown support, technical conversations are hard to read and lack structure.

## What Changes

- Add markdown rendering to conversation entry messages in the web UI
- Install a lightweight markdown library (`react-markdown`) for safe HTML rendering
- Create a reusable `MarkdownRenderer` component for consistent formatting
- Preserve existing plain text behavior (markdown is a superset of plain text)

## Capabilities

### New Capabilities
- `markdown-rendering`: Core markdown rendering component with syntax highlighting for code blocks, support for common markdown elements (headers, lists, links, images, blockquotes), and safe HTML sanitization

### Modified Capabilities
- `task-management`: Conversation entries now support markdown-formatted messages

## Impact

- **Code**: `packages/web-ui/src/components/TaskDrawer.tsx` — conversation message rendering
- **Dependencies**: New dependency on `react-markdown` (and optionally `remark-gfm` for GitHub Flavored Markdown support)
- **No breaking changes**: Existing plain text messages render identically since markdown is a superset of plain text
