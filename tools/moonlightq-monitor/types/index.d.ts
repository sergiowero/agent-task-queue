export type Health = 'unknown' | 'down' | 'degraded' | 'ok'

export type ServerStatus = {
  health: Health
  port: number
  pid: string | null
  latencyMs: number | null
  /** Runner jobs running right now. */
  working: number
  /** Agents seen in the last 5 minutes (the portal's "recent"). */
  online: number
  runnersRunning: number
  problems: string[]
  checkedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'moonlightq-monitor': {
      status: ServerStatus
      isHidden: boolean
      /** Port picked in the pane; null falls back to the configured port. */
      port: number | null
      /** Last start/stop outcome shown in the pane. */
      notice: string | null
    }
  }
}
