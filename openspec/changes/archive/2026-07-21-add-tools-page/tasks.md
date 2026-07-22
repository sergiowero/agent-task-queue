## 1. Backend API

- [x] 1.1 Add `POST /api/tools/install/execute` endpoint in `packages/web/src/index.ts` that runs `bun run install:bin && bun run install:skills` and streams output via SSE
- [x] 1.2 Add `GET /api/tools/install/skill-file` endpoint that reads and returns `skills/atq-workflow/SKILL.md` content

## 2. Tool Registry & Types

- [x] 2.1 Create `packages/web-ui/src/lib/tools.ts` with tool registry (static array of tool definitions with id, name, description, icon)
- [x] 2.2 Add API methods in `packages/web-ui/src/lib/api.ts` for install execute and skill file endpoints

## 3. Tools Page

- [x] 3.1 Create `packages/web-ui/src/pages/ToolsPage.tsx` with card grid layout showing available tools
- [x] 3.2 Add `/tools` route in `packages/web-ui/src/App.tsx`
- [x] 3.3 Add "Tools" nav entry with icon in `packages/web-ui/src/components/Layout.tsx`

## 4. Install Tool Page

- [x] 4.1 Create `packages/web-ui/src/pages/InstallToolPage.tsx` with execute button and skill file display
- [x] 4.2 Implement SSE streaming for install script execution output
- [x] 4.3 Implement skill file content display with copy-to-clipboard button
- [x] 4.4 Add `/tools/install` route in `packages/web-ui/src/App.tsx`
