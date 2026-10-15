# moonlightq-monitor

A Claude Code mod that watches the local MoonlightQ server: its PID, its health and how many agents are working.

- **Band above the prompt**: health, PID, port, latency, agents working and online. Click it to open the pane; **Open** opens the web UI in your browser.
- **Pane**: the same details, a Port field, a Start/Stop button and **Open web UI** (macOS `open http://localhost:<port>`).
- **Status line and toasts**: a short summary, and a toast when the server goes down, comes back or degrades.
- **`/moonlightq`**: `check` (default), `start [port]`, `stop`, `open`, `port <n>`, `pane`, `hide`, `show`.

Health comes from `/api/meta`, `/api/agents` and `/api/runners`; the PID from `lsof`. Start runs `bun run start` detached with `PORT` set, logging to `$TMPDIR/moonlightq-server-<port>.log`; Stop sends SIGTERM to whatever listens on the port.

## Install

From a terminal in this repository:

```bash
claude plugin marketplace add ./tools/moonlightq-monitor --scope project
claude plugin install moonlightq-monitor@moonlightq-tools --scope project
```

The plugin is read from this folder, so after editing it run `/reload-plugins` in a session.

## Options

Set in the plugin's config: `port` (default 3000), `intervalSeconds` (default 5) and `projectDir` (where Start runs; empty uses the session's folder).

## Tests

```bash
claude plugin validate tools/moonlightq-monitor
claude plugin test tools/moonlightq-monitor
```
