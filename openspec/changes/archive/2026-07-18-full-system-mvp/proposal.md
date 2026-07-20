## Why

The agent task queue system needs a functional MVP that allows users to interact with task queues through both a web interface and command-line tools. Currently there is no system in place to manage agent tasks, making it impossible to queue, track, or coordinate work across multiple agents.

## What Changes

- Create a new full-stack application with shared core logic
- Implement a REST API web server for HTTP-based task management
- Implement a CLI application for terminal-based task management
- Set up SQLite database for persistent task storage
- Establish shared entity definitions used by both interfaces

## Capabilities

### New Capabilities

- `task-management`: Core CRUD operations for creating, reading, updating, and deleting tasks
- `web-server`: REST API endpoints for HTTP clients to interact with the task queue
- `cli-app`: Command-line interface for terminal users to manage tasks
- `shared-entities`: Common TypeScript types and database schemas shared across web and CLI

### Modified Capabilities

<!-- No existing capabilities to modify -->

## Impact

- **New codebase**: Entirely new application structure
- **Dependencies**: Bun runtime, TypeScript, SQLite (via "bun:sqlite")
- **Database**: New SQLite database file for task storage
- **APIs**: New REST API endpoints under /api/tasks
- **CLI**: New bin entry point for the CLI tool
