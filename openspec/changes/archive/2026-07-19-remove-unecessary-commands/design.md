## Context

The CLI currently exposes two raw mutation commands (`atq update` and `atq delete`) that allow agents to directly modify task status and delete tasks. These bypass the workflow-driven state machine and are not needed by agents — status transitions happen through claim/submit actions. Task deletion is a user action that should live in the web portal only.

## Goals / Non-Goals

**Goals:**
- Remove `atq update` command from the CLI
- Remove `atq delete` command from the CLI
- Remove corresponding spec requirements

**Non-Goals:**
- No changes to the underlying database APIs (`updateTask`, `deleteTask`) — they remain available for the web server
- No changes to the shared package or web server

## Decisions

- **Keep database functions**: `updateTask` and `deleteTask` in `@atq/shared` stay. The web server still needs them for user-initiated operations via the web portal.
- **Just remove CLI commands**: The simplest change with highest safety. The commands are entirely in `packages/cli/src/index.ts` — two `program.command()` blocks to delete.
- **Spec removal is clean**: The two requirement blocks in `cli-app/spec.md` are standalone sections with no cross-references, so removing them is safe.

## Risks / Trade-offs

- **[Low] Agent loses ability to force-status a task**: This is intentional. Agents should never directly set status — the workflow actions are the correct path.
