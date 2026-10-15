import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const RECENT = new Date().toISOString()

function quietUi(on: On) {
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
}

function serverUp(on: On) {
  quietUi(on)
  fetchUp(on)
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '4242\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

function fetchUp(on: On) {
  on('http.fetch', async ($, e) => {
    const path = new URL(e.url).pathname
    const body =
      path === '/api/meta'
        ? { verifier: { online: true }, prSync: { errors: {} } }
        : path === '/api/agents'
          ? { data: [{ lastSeen: RECENT }, { lastSeen: RECENT }, { lastSeen: '2020-01-01T00:00:00Z' }] }
          : [
              { name: 'codex', enabled: true, state: { running: true, activeJobs: 2, lastError: null } },
              { name: 'claude', enabled: true, state: { running: true, activeJobs: 1, lastError: null } },
            ]

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
}

function serverDown(on: On) {
  quietUi(on)
  on('http.fetch', async () => ({ deny: 'connection refused' }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

const run = (args = '') => ({ command: 'moonlightq', args, origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 100 },
})

test('reports PID, health and working agents when the server is up', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  serverUp(on)

  const { text } = (await $.command.run(run())) as { text: string }

  expect(text).toContain('MoonlightQ ok')
  expect(text).toContain('PID 4242')
  expect(text).toContain('3 working')
  expect(text).toContain('2 online')
})

test('reports the server as down when it does not answer', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  serverDown(on)

  const { text } = (await $.command.run(run())) as { text: string }

  expect(text).toContain('MoonlightQ down (:3000)')
})

test('draws the band above the prompt on each surface', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  serverUp(on)
  await $.command.run(run())

  for (const surface of SURFACES) {
    const band = await $.ui.mount({
      plugin: 'moonlightq-monitor',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 4,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await band.find({ text: /PID 4242/ })).toBeDefined()
  }
})

test('draws the side pane with PID and working agents on each surface', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  serverUp(on)
  await $.command.run(run())

  for (const surface of SURFACES) {
    const pane = await $.ui.mount({
      plugin: 'moonlightq-monitor',
      surface,
      component: 'Pane',
      requestId: 'moonlightq',
      props: {
        title: 'MoonlightQ',
        isFocused: false,
        bodyColumns: 40,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    })
    expect(await pane.find({ text: '4242' })).toBeDefined()
    expect(await pane.find({ text: '3 agents' })).toBeDefined()
  }
})

test('clicking the band opens the pane on each surface', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  serverUp(on)
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  await $.command.run(run())

  for (const surface of SURFACES) {
    opened.length = 0
    const band = await $.ui.mount({
      plugin: 'moonlightq-monitor',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 4,
        bodyColumns: 100,
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    await band.press({ key: 'open-pane' })
    expect(opened).toEqual(['moonlightq'])
  }
})

const PANE_PROPS = {
  title: 'MoonlightQ',
  isFocused: true,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

function ok(stdout = '') {
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

test('the pane port input changes the watched port', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  quietUi(on)
  const urls: string[] = []
  on('http.fetch', async (_$, e) => {
    urls.push(e.url)

    return { deny: 'connection refused' }
  })
  on('process.run', async () => ok())

  for (const surface of SURFACES) {
    urls.length = 0
    const pane = await $.ui.mount({ plugin: 'moonlightq-monitor', surface, component: 'Pane', requestId: 'moonlightq', props: PANE_PROPS })
    await pane.input({ key: 'port', text: '4100' })
    expect(urls.some(u => u.startsWith('http://localhost:4100/'))).toBe(true)
    expect(await pane.find({ text: /:4100 \(custom\)/ })).toBeDefined()
  }
})

test('Start launches bun on the chosen port and Stop kills the listener', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  quietUi(on)
  on('http.fetch', async () => ({ deny: 'connection refused' }))
  let listening = false
  const ran: { argv: readonly string[]; env?: Record<string, string> }[] = []
  on('process.run', async (_$, e) => {
    ran.push({ argv: e.argv, env: e.init?.env })
    if (e.argv[0] === 'lsof') return ok(listening ? '777\n' : '')
    if (e.argv[0] === '/bin/sh') {
      listening = true

      return ok('/tmp/moonlightq-server-4200.log\n')
    }
    listening = false

    return ok()
  })

  const started = (await $.command.run(run('start 4200'))) as { text: string }
  expect(started.text).toContain('Starting on :4200')
  const sh = ran.find(r => r.argv[0] === '/bin/sh')
  expect(sh?.env).toEqual({ PORT: '4200' })
  expect(sh?.argv[2]).toContain('bun run start')

  const stopped = (await $.command.run(run('stop'))) as { text: string }
  expect(stopped.text).toBe('Stopped PID 777 on :4200.')
  expect(ran.some(r => r.argv[0] === 'kill' && r.argv[1] === '777')).toBe(true)
})

test('Open web UI opens the browser on the watched port, from the pane and the band', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  quietUi(on)
  fetchUp(on)
  const opened: string[] = []
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'open') {
      opened.push(String(e.argv[1]))

      return ok()
    }

    return ok('4242\n')
  })
  await $.command.run(run('port 4300'))

  for (const surface of SURFACES) {
    opened.length = 0
    const pane = await $.ui.mount({ plugin: 'moonlightq-monitor', surface, component: 'Pane', requestId: 'moonlightq', props: PANE_PROPS })
    await pane.press({ key: 'open-web' })
    const band = await $.ui.mount({
      plugin: 'moonlightq-monitor',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    await band.press({ key: 'open-web' })
    expect(opened).toEqual(['http://localhost:4300', 'http://localhost:4300'])
  }
})
