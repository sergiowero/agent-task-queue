## Context

The ATQ web UI currently has 4 pages: Board, Projects, Agents, and Activity. Users need a way to access ATQ utilities (CLI installation, skill distribution) from the browser without switching to the terminal. The project has existing install scripts in `packages/installer/src/` that handle CLI binary compilation and skill file distribution.

## Goals / Non-Goals

**Goals:**
- Add a `/tools` page with card-based navigation to individual tool pages
- Implement an "Install ATQ" tool that can execute the install script or display skill file content
- Follow existing page patterns (layout, styling, data fetching)

**Non-Goals:**
- Building a generic tool framework for third-party tools
- Implementing user authentication for tool execution
- Supporting remote execution on user machines

## Decisions

### 1. Tool execution model: Backend API with SSE streaming

**Decision**: Execute install scripts via a backend API endpoint that streams output using Server-Sent Events (SSE).

**Why**: The install script runs on the server, not the client. SSE provides real-time feedback without WebSocket complexity. The existing `ActivityPage` already uses SSE for live updates.

**Alternatives considered**:
- WebSocket: More complex, not needed for unidirectional output
- Polling: Higher latency, more API calls

### 2. Fallback for restricted environments: Show skill file content

**Decision**: When execution fails (permissions, missing dependencies), display the `atq-workflow/SKILL.md` content with a copy button.

**Why**: Users may be in restricted environments where they can't execute scripts. Showing the skill file lets them manually copy it to their AI tool's skill directory.

### 3. Tool registry: Static configuration

**Decision**: Define tools in a static TypeScript array, not a dynamic API.

**Why**: Tools are fixed at build time. A static registry is simpler, type-safe, and avoids unnecessary API calls. New tools require a code change anyway.

## Risks / Trade-offs

- **[Risk] Script execution on server** → Mitigate with timeout limits and output sanitization
- **[Risk] No actual remote execution** → Document that install script runs on the server, not the user's machine. Users wanting local install should use the terminal command directly.
