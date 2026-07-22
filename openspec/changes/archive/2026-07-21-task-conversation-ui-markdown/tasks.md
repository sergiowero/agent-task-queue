## 1. Dependencies

- [x] 1.1 Install `react-markdown`, `remark-gfm`, and `rehype-highlight` in `packages/web-ui`
- [x] 1.2 Install highlight.js CSS theme (e.g., `github-dark`) in `packages/web-ui`

## 2. Markdown Renderer Component

- [x] 2.1 Create `packages/web-ui/src/components/MarkdownRenderer.tsx` with `react-markdown` + `remark-gfm` + `rehype-highlight`
- [x] 2.2 Add component props interface: `{ content: string; className?: string }`
- [x] 2.3 Configure safe rendering (no raw HTML by default)

## 3. Conversation Integration

- [x] 3.1 Update `TaskDrawer.tsx` to import and use `MarkdownRenderer` for conversation message display
- [x] 3.2 Replace `<p className="text-sm text-text mt-0.5 whitespace-pre-wrap">{entry.message}</p>` with `<MarkdownRenderer content={entry.message} />`
- [x] 3.3 Verify plain text messages render identically to previous behavior

## 4. Styling

- [x] 4.1 Add CSS styles for markdown elements (code blocks, tables, blockquotes, lists) matching the existing theme
- [x] 4.2 Ensure code blocks have proper padding, background, and syntax highlighting colors
- [x] 4.3 Style tables with borders and alternating row colors

## 5. Verification

- [x] 5.1 Test with plain text messages — confirm no visual regression
- [x] 5.2 Test with markdown formatted messages — confirm bold, italic, code, lists, links render correctly
- [x] 5.3 Test with GFM extensions — tables, task lists, strikethrough
- [x] 5.4 Test XSS prevention — confirm `<script>` tags and event handlers are not executed
