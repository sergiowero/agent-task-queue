## Context

Task conversations are stored as JSON arrays of `{ authorName, timestamp, message }` objects in SQLite. The web UI renders these in `TaskDrawer.tsx` using a simple `<p>` tag with `whitespace-pre-wrap`. No markdown parsing exists — messages display as raw plain text.

Agents increasingly generate structured responses with code blocks, lists, and formatting that lose readability without proper rendering.

## Goals / Non-Goals

**Goals:**
- Render markdown in conversation entry messages with proper formatting
- Support GitHub Flavored Markdown (GFM): tables, task lists, strikethrough
- Syntax-highlighted code blocks for technical content
- Safe rendering (no XSS via raw HTML)
- Maintain backward compatibility with existing plain text messages

**Non-Goals:**
- Rich text editing (users still write plain text / markdown)
- Real-time collaborative editing
- Image upload/paste in conversation
- Custom emoji or extended markdown syntax

## Decisions

### 1. Library: `react-markdown` + `remark-gfm` + `rehype-highlight`

**Choice**: Use `react-markdown` as the core renderer with `remark-gfm` for GFM support and `rehype-highlight` for syntax highlighting.

**Alternatives considered**:
- `marked` — faster but less safe by default, requires manual sanitization
- `showdown` — older, less maintained, weaker React integration
- `markdown-it` — good performance but more boilerplate for React

**Rationale**: `react-markdown` is the de-facto standard for React markdown rendering. It's built on the unified ecosystem (remark/rehype), handles security by default (no raw HTML unless explicitly allowed), and has excellent GFM support via plugin. `rehype-highlight` provides syntax highlighting using highlight.js, which is lightweight and well-maintained.

### 2. Component Architecture

**Choice**: Create a `MarkdownRenderer` component in `packages/web-ui/src/components/MarkdownRenderer.tsx`.

**Rationale**: Single responsibility — encapsulates all markdown rendering logic. Reusable if markdown rendering is needed elsewhere (e.g., activity feed, task descriptions). Easy to test in isolation.

### 3. Code Block Styling

**Choice**: Use highlight.js CSS theme (e.g., `github-dark`) imported at the component level.

**Alternatives considered**:
- Shiki — heavier, requires build-time highlighting
- Prism — larger bundle, more languages than needed
- No highlighting — simpler but less useful for technical conversations

**Rationale**: highlight.js is lightweight (~20KB gzipped), supports 190+ languages, and works well with `rehype-highlight`. The CSS theme can be customized later.

### 4. HTML Sanitization

**Choice**: `react-markdown` disables raw HTML by default (v9+). No additional sanitization needed unless we explicitly allow HTML.

**Rationale**: Secure by default. If agents or users need to include HTML in the future, we can add `rehype-raw` with a whitelist, but that's out of scope.

## Risks / Trade-offs

- **Bundle size increase** (~25KB gzipped for react-markdown + remark-gfm + rehype-highlight) → Acceptable for the UX improvement; can lazy-load if needed later
- **Performance on long messages** → Markdown parsing is fast; only renders when component mounts. No virtualization needed for typical conversation lengths.
- **Existing messages without markdown** → Plain text renders identically since markdown is a superset. No migration needed.
- **Agent-generated content may contain malformed markdown** → `react-markdown` gracefully degrades to plain text for invalid syntax.
