import type { EngineInterface, Register } from 'claude-code'

import type { Health, ServerStatus } from '../types'

const RECENT_MS = 5 * 60 * 1000
const TIMEOUT_MS = 3000

const initial: ServerStatus = {
  health: 'unknown',
  port: 3000,
  pid: null,
  latencyMs: null,
  working: 0,
  online: 0,
  runnersRunning: 0,
  problems: [],
  checkedAt: 0,
}

const STATUS = { plugin: 'moonlightq-monitor', key: 'status' } as const
const HIDDEN = { plugin: 'moonlightq-monitor', key: 'isHidden' } as const
const PANE = 'moonlightq'

type Agent = { lastSeen: string | null }
type Runner = {
  name: string
  enabled: boolean
  state: { running: boolean; activeJobs: number; lastError: string | null }
}
type Meta = {
  verifier?: { online?: boolean }
  prSync?: { available?: boolean; enabled?: boolean; errors?: Record<string, unknown> }
}

const DOT: Record<Health, string> = { unknown: '○', down: '●', degraded: '●', ok: '●' }
const COLOR: Record<Health, string> = { unknown: 'gray', down: 'red', degraded: 'yellow', ok: 'green' }

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 ? value : fallback
}

async function getJson<T>($: EngineInterface, url: string): Promise<T> {
  const timeout = $.clock.sleep(TIMEOUT_MS).then(() => {
    throw new Error('timed out')
  })
  const res = await Promise.race([$.http.fetch(url), timeout])
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  return JSON.parse(res.text) as T
}

/** PID of the process listening on the port, via lsof; null when nothing listens or lsof is missing. */
async function listeningPid($: EngineInterface, port: number): Promise<string | null> {
  try {
    const { stdout } = await $.process.run(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      timeoutMs: TIMEOUT_MS,
    })
    const pids = stdout.split('\n').map(s => s.trim()).filter(Boolean)

    return pids.length > 0 ? pids.join(', ') : null
  } catch {
    return null
  }
}

async function check($: EngineInterface, port: number): Promise<ServerStatus> {
  const base = `http://localhost:${port}`
  const startedAt = await $.clock.now()
  const pidPromise = listeningPid($, port)

  let meta: Meta
  try {
    meta = await getJson<Meta>($, `${base}/api/meta`)
  } catch (err) {
    const pid = await pidPromise
    const reason = err instanceof Error ? err.message : String(err)

    return {
      ...initial,
      health: 'down',
      port,
      pid,
      problems: [pid ? `PID ${pid} listens but /api/meta failed: ${reason}` : `not running on :${port}`],
      checkedAt: await $.clock.now(),
    }
  }
  const latencyMs = Math.round((await $.clock.now()) - startedAt)

  const [agents, runners, pid] = await Promise.all([
    getJson<{ data: Agent[] }>($, `${base}/api/agents?limit=500`).catch(() => null),
    getJson<Runner[]>($, `${base}/api/runners`).catch(() => null),
    pidPromise,
  ])

  const now = Date.now()
  const problems: string[] = []
  if (meta.verifier?.online === false) problems.push('verifier offline')
  const prErrors = Object.keys(meta.prSync?.errors ?? {}).length
  if (prErrors > 0) problems.push(`PR sync: ${prErrors} task(s) failing`)
  if (agents === null) problems.push('/api/agents failed')
  if (runners === null) problems.push('/api/runners failed')
  for (const r of runners ?? []) {
    if (r.state.lastError) problems.push(`runner ${r.name}: ${r.state.lastError}`)
  }

  return {
    health: problems.length > 0 ? 'degraded' : 'ok',
    port,
    pid,
    latencyMs,
    working: (runners ?? []).reduce((sum, r) => sum + (r.state.activeJobs ?? 0), 0),
    online: (agents?.data ?? []).filter(a => a.lastSeen && now - new Date(a.lastSeen).getTime() < RECENT_MS)
      .length,
    runnersRunning: (runners ?? []).filter(r => r.state.running).length,
    problems,
    checkedAt: await $.clock.now(),
  }
}

function summary(s: ServerStatus): string {
  if (s.health === 'unknown') return 'MoonlightQ: checking…'
  if (s.health === 'down') return `MoonlightQ down (:${s.port})`

  return `MoonlightQ ${s.health} · PID ${s.pid ?? '?'} · ${s.working} working · ${s.online} online`
}

const PORT = { plugin: 'moonlightq-monitor', key: 'port' } as const
const NOTICE = { plugin: 'moonlightq-monitor', key: 'notice' } as const

let isChecking = false
let lastHealth: Health = 'unknown'
let configuredPort = 3000
let projectDir = ''

async function currentPort($: EngineInterface): Promise<number> {
  return (await $.state.get(PORT)).value ?? configuredPort
}

async function tick($: EngineInterface): Promise<void> {
  if (isChecking) return
  isChecking = true
  try {
    const port = await currentPort($)
    const next = await check($, port)
    await $.state.set(STATUS, next)
    $.ui.status(summary(next))

    const prevHealth = lastHealth
    lastHealth = next.health
    if (prevHealth !== 'unknown' && prevHealth !== next.health) {
      $.ui.toast(
        next.health === 'down'
          ? `MoonlightQ server went down (:${port})`
          : next.health === 'ok'
            ? `MoonlightQ server is healthy (PID ${next.pid ?? '?'})`
            : `MoonlightQ degraded: ${next.problems[0]}`,
      )
    }
  } finally {
    isChecking = false
  }
}

/** Parses a port typed by the person; empty means "back to the configured one". */
function parsePort(text: string): number | null | 'invalid' {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)

  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 'invalid'
}

async function setPort($: EngineInterface, text: string): Promise<string> {
  const parsed = parsePort(text)
  if (parsed === 'invalid') return `"${text.trim()}" is not a port (1-65535).`
  await $.state.set(PORT, parsed)
  lastHealth = 'unknown'
  await tick($)

  return `Watching :${parsed ?? configuredPort}${parsed === null ? ' (configured default)' : ''}.`
}

/** Starts `bun run start` detached on the current port; the log goes to $TMPDIR. */
async function startServer($: EngineInterface): Promise<string> {
  const port = await currentPort($)
  const s = await check($, port)
  if (s.pid) return `Something already listens on :${port} (PID ${s.pid}).`

  const log = `\${TMPDIR:-/tmp}/moonlightq-server-${port}.log`
  const script = `export PATH="$HOME/.bun/bin:$PATH"; nohup bun run start > "${log}" 2>&1 < /dev/null & echo "${log}"`
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['/bin/sh', '-c', script], {
      ...(projectDir ? { cwd: projectDir } : {}),
      env: { PORT: String(port) },
      timeoutMs: 10_000,
    })
    if (exitCode !== 0) return `Start failed: ${stderr.trim() || `exit ${exitCode}`}`
    $.clock.after(4000, () => void tick($))
    $.clock.after(12_000, () => void tick($))

    return `Starting on :${port} (builds the UI first). Log: ${stdout.trim()}`
  } catch (err) {
    return `Start failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** Sends SIGTERM to whatever listens on the current port. */
async function stopServer($: EngineInterface): Promise<string> {
  const port = await currentPort($)
  const pid = await listeningPid($, port)
  if (!pid) return `Nothing listens on :${port}.`

  const pids = pid.split(', ')
  try {
    const { exitCode, stderr } = await $.process.run(['kill', ...pids], { timeoutMs: TIMEOUT_MS })
    if (exitCode !== 0) return `Stop failed: ${stderr.trim() || `exit ${exitCode}`}`
  } catch (err) {
    return `Stop failed: ${err instanceof Error ? err.message : String(err)}`
  }
  $.clock.after(1500, () => void tick($))

  return `Stopped PID ${pid} on :${port}.`
}

async function act($: EngineInterface, what: 'start' | 'stop'): Promise<string> {
  await $.state.set(NOTICE, what === 'start' ? 'Starting…' : 'Stopping…')
  const notice = what === 'start' ? await startServer($) : await stopServer($)
  await $.state.set(NOTICE, notice)

  return notice
}

export const register: Register = (on, options) => {
  configuredPort = asNumber(options?.port, 3000)
  projectDir = typeof options?.projectDir === 'string' ? options.projectDir.trim() : ''
  const intervalMs = asNumber(options?.intervalSeconds, 5) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'moonlightq',
      description: 'MoonlightQ server: check | start | stop | port <n> | pane | hide | show',
    })
    void $.ui.open({ id: PANE, title: 'MoonlightQ' })
    void tick($)
    $.clock.every(intervalMs, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'moonlightq' }, async ($, e) => {
    const [verb = '', ...rest] = (e.args ?? '').trim().split(/\s+/)
    if (verb === 'hide' || verb === 'show') {
      await $.state.set(HIDDEN, verb === 'hide')

      return { text: `MoonlightQ band ${verb === 'hide' ? 'hidden' : 'shown'}.` }
    }
    if (verb === 'pane') {
      const opened = await $.ui.open({ id: PANE, title: 'MoonlightQ' })

      return { text: opened.isPlaced ? 'MoonlightQ pane opened.' : 'This surface has no room for panes here.' }
    }
    if (verb === 'port') return { text: await setPort($, rest.join(' ')) }
    if (verb === 'start' || verb === 'stop') {
      if (rest[0]) {
        const msg = await setPort($, rest[0])
        if (msg.includes('not a port')) return { text: msg }
      }

      return { text: await act($, verb) }
    }
    await tick($)
    const s = (await $.state.get(STATUS)).value ?? initial
    const lines = [
      summary(s),
      s.latencyMs !== null ? `latency ${s.latencyMs}ms · ${s.runnersRunning} runner(s) running` : '',
      ...s.problems.map(p => `- ${p}`),
    ].filter(Boolean)

    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await $.state.get(HIDDEN)).value) return next(e)

    const s = (await $.state.get(STATUS)).value ?? initial
    const { Box, Button, Text } = $.ui.resolve(e)
    const ago = s.checkedAt ? Math.max(0, Math.round(((await $.clock.now()) - s.checkedAt) / 1000)) : null

    return (
      <Box flexDirection="column">
        <Button key="open-pane" plain onPress={() => void $.ui.open({ id: PANE, title: 'MoonlightQ' })}>
          <Text color={COLOR[s.health]}>{DOT[s.health]} </Text>
          <Text bold>MoonlightQ </Text>
          {s.health === 'down' ? (
            <Text color="red">not running on :{s.port}</Text>
          ) : s.health === 'unknown' ? (
            <Text dimColor>checking…</Text>
          ) : (
            <Text>
              {s.health} · PID {s.pid ?? '?'} · :{s.port} · {s.latencyMs}ms · {s.working} agent
              {s.working === 1 ? '' : 's'} working ({s.online} online, {s.runnersRunning} runner
              {s.runnersRunning === 1 ? '' : 's'})
            </Text>
          )}
          {ago !== null && <Text dimColor> · {ago}s ago</Text>}
        </Button>
        {s.health !== 'down' &&
          s.problems.slice(0, 3).map(p => (
            <Text color="yellow">
              {'  '}⚠ {p}
            </Text>
          ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = (await $.state.get(STATUS)).value ?? initial
    const portOverride = (await $.state.get(PORT)).value ?? null
    const notice = (await $.state.get(NOTICE)).value ?? null
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Input = 'Input' in els ? els.Input : null
    const ago = s.checkedAt ? Math.max(0, Math.round(((await $.clock.now()) - s.checkedAt) / 1000)) : null
    const isUp = s.pid !== null
    const row = (label: string, value: string) => (
      <Box>
        <Text dimColor>{label.padEnd(9)}</Text>
        <Text>{value}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={COLOR[s.health]}>{DOT[s.health]} </Text>
          <Text bold color={COLOR[s.health]}>
            {s.health === 'unknown' ? 'checking…' : s.health === 'down' ? 'down' : s.health}
          </Text>
        </Box>
        {row('Port', `:${s.port}${portOverride === null ? '' : ' (custom)'}`)}
        {row('PID', s.pid ?? '—')}
        {s.health !== 'down' && s.health !== 'unknown' && (
          <Box flexDirection="column">
            {row('Latency', `${s.latencyMs}ms`)}
            {row('Working', `${s.working} agent${s.working === 1 ? '' : 's'}`)}
            {row('Online', `${s.online} agent${s.online === 1 ? '' : 's'} (5 min)`)}
            {row('Runners', `${s.runnersRunning} running`)}
          </Box>
        )}
        {s.problems.map(p => (
          <Text color={s.health === 'down' ? 'red' : 'yellow'}>⚠ {p}</Text>
        ))}
        {ago !== null && <Text dimColor>checked {ago}s ago</Text>}
        {Input ? (
          <Box marginTop={1}>
            <Input
            key="port"
            label="Port"
            placeholder={`${configuredPort} (default)`}
            value={portOverride === null ? '' : String(portOverride)}
            submitLabel="Set"
            onSubmit={(value: string) => {
              void setPort($, value).then(msg => $.state.set(NOTICE, msg))
            }}
            />
          </Box>
        ) : (
          <Text dimColor>Change the port with {'/moonlightq port <n>'}</Text>
        )}
        <Box>
          {isUp ? (
            <Button key="stop" label="Stop" onPress={() => void act($, 'stop')} />
          ) : (
            <Button key="start" label="Start" variant="primary" onPress={() => void act($, 'start')} />
          )}
        </Box>
        {notice && <Text dimColor>{notice}</Text>}
      </Box>
    )
  })
}
