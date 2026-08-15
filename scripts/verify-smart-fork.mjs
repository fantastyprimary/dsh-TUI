/**
 * Channel-level regression for toggling the orthogonal Smart enhancement on
 * a started Standard-preset session. A real createChannel is wired to
 * recording session, agent-factory, Cordis-context, and preset-roster fakes.
 *
 * The verifier covers Smart on, Smart off, and a failed Smart-on replacement:
 * each requested transition forks the complete transcript, preserves the
 * Standard preset and model route, mounts the expected composition, and keeps
 * the old handle alive until replacement creation succeeds. A failed create
 * must leave the live agent, transcript, and Smart sidecar byte-for-byte
 * unchanged.
 *
 * The script creates its own throwaway HOME so it never reads or writes the
 * operator's real ~/.dsh-tui preferences.
 *
 * Run with plain node against the compiled lib (after `pnpm build`):
 *   node scripts/verify-smart-fork.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const testHome = mkdtempSync(join(tmpdir(), 'dsh-tui-smart-fork-'))
process.env.HOME = testHome
process.env.USERPROFILE = testHome

let failed = 0

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

async function withTimeout(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function transcriptOf(channel) {
  return channel.rows.map(row => ({
    kind: row.kind,
    text: row.text,
    seq: row.seq,
    streaming: row.streaming,
  }))
}

function pluginName(plugin) {
  return plugin?.name ?? plugin?.default?.name ?? 'anonymous'
}

function makeScopedContext(label) {
  const listeners = new Map()
  const pluginCalls = []
  const ctx = {
    label,
    agent: {},
    pluginCalls,
    tools: {
      get() { return undefined },
    },
    isolate() {
      return ctx
    },
    on(event, handler) {
      let handlers = listeners.get(event)
      if (handlers === undefined) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    async plugin(plugin, config) {
      pluginCalls.push({ plugin, config, name: pluginName(plugin) })
    },
  }
  return ctx
}

function makeHostContext(services) {
  const listeners = new Map()
  const warnings = []
  const hostPluginCalls = []
  const root = {
    agents: { get() { return undefined } },
    on(event, handler) {
      let handlers = listeners.get(event)
      if (handlers === undefined) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    async plugin(plugin, config) {
      hostPluginCalls.push({ plugin, config, name: pluginName(plugin) })
    },
  }
  const ctx = {
    root,
    effect(register) {
      return register()
    },
    on(event, handler) {
      let handlers = listeners.get(event)
      if (handlers === undefined) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    get(name) {
      return services[name]
    },
    logger: {
      warn(message) {
        warnings.push(message)
      },
      info() {},
    },
  }
  return {
    ctx,
    warnings,
    hostPluginCalls,
    emit(event, ...args) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(...args)
    },
  }
}

const CWD = '/work/smart-fork'
const PROVIDER = 'test-provider'
const MODEL = 'test-model'
const START = 1_800_000_000_000
const STANDARD = { id: 'standard', trust: 'system', name: 'Standard' }

function startedEvents() {
  return [
    { type: 'turn/start', seq: 0, time: START, data: { turn: 0 } },
    {
      type: 'user/message',
      seq: 1,
      time: START + 1,
      data: {
        id: 'message-user-1',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Keep this question across Smart forks.' }],
      },
    },
    { type: 'step/start', seq: 2, time: START + 2, data: { turn: 0, step: 0 } },
    {
      type: 'assistant/message',
      seq: 3,
      time: START + 3,
      data: {
        turn: 0,
        step: 0,
        message: {
          id: 'message-assistant-1',
          role: 'assistant',
          source: { kind: 'model', provider: PROVIDER, model: MODEL },
          content: [{ type: 'text', text: 'This answer must remain visible.' }],
        },
        usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    },
    { type: 'step/end', seq: 4, time: START + 4, data: { turn: 0, step: 0 } },
    { type: 'turn/end', seq: 5, time: START + 5, data: { turn: 0, reason: { kind: 'completed' } } },
  ]
}

try {
  const { createChannel } = await import('../lib/types/dsh-adapter/channel.js')

  const services = {}
  const host = makeHostContext(services)
  const timeline = []
  const mountCalls = []
  const recomposeCalls = []
  const resolveCalls = []

  // Smart is deliberately absent: it is an overlay over this one official
  // preset, never another roster entry.
  services.agentPresets = {
    defaultId: 'standard',
    async list() {
      return [STANDARD]
    },
    async resolve(id = 'standard') {
      resolveCalls.push(id)
      if (id !== 'standard') throw new Error(`unknown preset: ${id}`)
      return STANDARD
    },
    async mount(agentCtx, id = 'standard') {
      if (id !== 'standard') throw new Error(`unknown preset: ${id}`)
      agentCtx.mountedPreset = id
      mountCalls.push({ agentCtx, id })
      timeline.push(`mount:${id}:${agentCtx.label}`)
      return STANDARD
    },
    async recompose(agentCtx, id) {
      recomposeCalls.push({ agentCtx, id })
      if (id !== 'standard') throw new Error(`unknown preset: ${id}`)
      return STANDARD
    },
  }

  function makeSession(id, agentPreset, events, meta = {}) {
    let log = [...events]
    const session = {
      id,
      header: {
        version: 0,
        id,
        createdAt: START,
        ...meta,
        agentPreset,
      },
      get seq() {
        return log.at(-1)?.seq ?? -1
      },
      get events() {
        return log
      },
      append(type, data) {
        const event = { type, seq: (log.at(-1)?.seq ?? -1) + 1, time: Date.now(), data }
        log = [...log, event]
        host.emit('session/event', session, event)
        return event
      },
      requestHeader() {
        return undefined
      },
      deriveMessages() {
        return []
      },
    }
    return session
  }

  function makeAgent(session, agentCtx) {
    return {
      id: session.id,
      status: 'idle',
      session,
      ctx: agentCtx,
      followup() {},
      steer() {},
      inbox: { remove: () => false },
    }
  }

  function makeHandle(agent) {
    const marker = `dispose:${agent.session.id}`
    return {
      agent,
      disposed: false,
      disposeCalls: 0,
      marker,
      async dispose() {
        this.disposeCalls += 1
        this.disposed = true
        timeline.push(marker)
      },
    }
  }

  const forkCalls = []
  services.sessions = {
    fork(...args) {
      const [source, boundary] = args
      const seed = [...source.events]
      forkCalls.push({ source, boundary, argCount: args.length, seed })
      timeline.push(`fork:${source.id}`)
      return { events: seed }
    },
  }

  const createCalls = []
  const createGates = []
  let rejectNextCreate = false

  function gateNextCreate() {
    const entered = deferred()
    const release = deferred()
    createGates.push({ entered, release })
    return {
      entered: entered.promise,
      release: () => release.resolve(),
    }
  }

  services.agents = {
    async create(options) {
      const gate = createGates.shift()
      const shouldReject = rejectNextCreate
      rejectNextCreate = false
      const agentCtx = makeScopedContext(`child-${createCalls.length + 1}`)
      const call = {
        options,
        agentCtx,
        startMarker: `create:start:${options.sessionId}`,
        resolvedMarker: `create:resolved:${options.sessionId}`,
        rejectedMarker: `create:rejected:${options.sessionId}`,
      }
      createCalls.push(call)
      timeline.push(call.startMarker)

      try {
        const commit = await options.setup?.(agentCtx)
        commit?.commit?.()
        call.setupCompleted = true
      } catch (error) {
        call.setupError = error
        gate?.entered.resolve(call)
        throw error
      }
      gate?.entered.resolve(call)
      if (gate !== undefined) await gate.release.promise

      if (shouldReject) {
        call.rejected = true
        timeline.push(call.rejectedMarker)
        throw new Error('create failed for test')
      }

      const session = makeSession(
        options.sessionId,
        options.meta?.agentPreset,
        options.seed ?? [],
        options.meta ?? {},
      )
      call.handle = makeHandle(makeAgent(session, agentCtx))
      timeline.push(call.resolvedMarker)
      return call.handle
    },
  }

  function assertForkRequest(label, index, sourceSession) {
    const fork = forkCalls[index]
    const creation = createCalls[index]
    check(
      `${label}: sessions.fork receives the live session with no boundary`,
      fork?.source === sourceSession && fork?.argCount === 1 && fork?.boundary === undefined,
    )
    check(
      `${label}: fork seed is the complete source log`,
      fork !== undefined && fork.seed.length === sourceSession.events.length && same(fork.seed, sourceSession.events),
      `${fork?.seed.length ?? 0}/${sourceSession.events.length} events`,
    )
    check(`${label}: agents.create receives the exact fork seed`, creation?.options.seed === fork?.seed)
    check(
      `${label}: agents.create uses a new child session id`,
      typeof creation?.options.sessionId === 'string' &&
        creation.options.sessionId.length > 0 &&
        creation.options.sessionId !== sourceSession.id,
      String(creation?.options.sessionId),
    )
    check(
      `${label}: child metadata preserves cwd, lineage, seed length, and Standard preset`,
      creation?.options.meta?.cwd === CWD &&
        creation.options.meta.parentSession === sourceSession.id &&
        creation.options.meta.seedLength === fork?.seed.length &&
        creation.options.meta.agentPreset === 'standard',
      JSON.stringify(creation?.options.meta),
    )
    check(
      `${label}: child keeps the provider/model route`,
      same(creation?.options.agentOptions, { provider: PROVIDER, model: MODEL }),
      JSON.stringify(creation?.options.agentOptions),
    )
    const mount = mountCalls.find(item => item.agentCtx === creation?.agentCtx)
    check(
      `${label}: create setup mounts Standard in the unpublished child context`,
      typeof creation?.options.setup === 'function' &&
        creation.setupCompleted === true &&
        mount?.id === 'standard' &&
        creation.agentCtx.mountedPreset === 'standard',
      mount?.id,
    )
  }

  function assertSuccessfulSwap(label, index, oldHandle, expectedRows, smart, forceSmart = false) {
    const creation = createCalls[index]
    const resolvedAt = timeline.indexOf(creation.resolvedMarker)
    const disposedAt = timeline.indexOf(oldHandle.marker)
    check(
      `${label}: old handle is disposed once and only after create resolves`,
      oldHandle.disposeCalls === 1 && resolvedAt >= 0 && disposedAt > resolvedAt,
      `${resolvedAt} -> ${disposedAt}`,
    )
    check(
      `${label}: channel adopts the child while retaining Standard`,
      channel.agentId === creation.handle?.agent.id &&
        channel.agentPreset === 'standard' &&
        creation.handle?.agent.session.header.agentPreset === 'standard' &&
        channel.smart === smart &&
        channel.forceSmart === forceSmart,
      `${channel.agentId}/${channel.agentPreset}/smart=${channel.smart}/forceSmart=${channel.forceSmart}`,
    )
    check(
      `${label}: replay retains every visible transcript row`,
      same(transcriptOf(channel), expectedRows),
      JSON.stringify(transcriptOf(channel)),
    )
  }

  const smartFile = join(testHome, '.dsh-tui', 'smart.json')
  const sidecarText = () => readFileSync(smartFile, 'utf8')
  const sidecar = () => JSON.parse(sidecarText())
  const forceSmartFile = join(testHome, '.dsh-tui', 'force-smart.json')
  const forceSidecarText = () => readFileSync(forceSmartFile, 'utf8')
  const forceSidecar = () => JSON.parse(forceSidecarText())

  const initialSession = makeSession('session-standard-0', 'standard', startedEvents(), { cwd: CWD })
  const initialAgent = makeAgent(initialSession, makeScopedContext('initial-standard'))
  const initialHandle = makeHandle(initialAgent)
  const channel = createChannel(host.ctx, initialAgent, {
    model: MODEL,
    cwd: CWD,
    provider: PROVIDER,
    activity: false,
    agentPreset: 'standard',
    smart: false,
    forceSmart: false,
    handle: initialHandle,
  })
  const originalRows = transcriptOf(channel)
  const listed = await channel.listPresets()

  check(
    'fixture is a started, non-Smart Standard session',
    channel.agentPreset === 'standard' &&
      channel.smart === false &&
      initialSession.events.some(event => event.type === 'turn/start') &&
      originalRows.some(row => row.kind === 'user') &&
      originalRows.some(row => row.kind === 'assistant'),
    JSON.stringify(originalRows),
  )
  check(
    'fake roster exposes Standard only (Smart is not a preset)',
    listed.length === 1 && listed[0]?.id === 'standard',
    JSON.stringify(listed),
  )

  // Smart on over Standard.
  const onGate = gateNextCreate()
  const switchOn = channel.switchSmart(true)
  const onCreation = await withTimeout(onGate.entered, 'switchSmart(true) agents.create')
  check(
    'Smart on: Standard handle stays active while create is pending',
    initialHandle.disposeCalls === 0 && channel.agentId === initialAgent.id && channel.smart === false,
  )
  host.emit('agent/status', { agent: initialAgent, status: 'running' })
  check('Smart on: old agent subscription remains active while pending', channel.status === 'running')
  onGate.release()
  const onResult = await switchOn

  check('Smart on: switchSmart(true) returns true', onResult === true)
  assertForkRequest('Smart on', 0, initialSession)
  assertSuccessfulSwap('Smart on', 0, initialHandle, originalRows, true)
  check(
    'Smart on: setup adds router and marker after mounting Standard',
    same(onCreation.agentCtx.pluginCalls.map(call => call.name), ['tool-str-replace-editor', 'dsh-tui-smart-marker', 'router-bootstrap']),
    JSON.stringify(onCreation.agentCtx.pluginCalls.map(call => call.name)),
  )
  check(
    'Smart on: host runtime is initialized once',
    same(host.hostPluginCalls.map(call => call.name), ['dsh-tui-smart-runtime']),
    JSON.stringify(host.hostPluginCalls.map(call => call.name)),
  )
  const onSidecar = sidecar()
  check(
    'Smart on: sidecar saves the new child and default as enabled',
    onSidecar.enabled === true && onSidecar.sessions?.[onCreation.options.sessionId]?.enabled === true,
    JSON.stringify(onSidecar),
  )
  const onHandle = onCreation.handle
  const onSession = onHandle.agent.session

  // Enabling ForceSmart automatically replaces Smart in one fork.
  const forceGate = gateNextCreate()
  const switchForce = channel.switchForceSmart(true)
  const forceCreation = await withTimeout(forceGate.entered, 'switchForceSmart(true) agents.create')
  check(
    'ForceSmart on: Smart handle stays active while one replacement is pending',
    onHandle.disposeCalls === 0 && channel.smart === true && channel.forceSmart === false,
  )
  forceGate.release()
  const forceResult = await switchForce

  check('ForceSmart on: switchForceSmart(true) returns true', forceResult === true)
  assertForkRequest('ForceSmart on', 1, onSession)
  assertSuccessfulSwap('ForceSmart on', 1, onHandle, originalRows, false, true)
  check(
    'ForceSmart on: setup mounts exactly one ForceSmart overlay after Standard',
    same(forceCreation.agentCtx.pluginCalls.map(call => call.name), [
      ...(process.platform === 'win32'
        ? ['dsh-tui-force-smart-windows-bash']
        : ['TerminalSessionService', 'terminal-bash', 'tool-bash-persistent']),
      'tool-str-replace-editor',
      'dsh-tui-force-smart-marker',
      'dsh-tui-force-smart-bootstrap',
    ]),
    JSON.stringify(forceCreation.agentCtx.pluginCalls.map(call => call.name)),
  )
  check(
    'ForceSmart on: both child sidecars record the mutually exclusive state',
    sidecar().sessions?.[forceCreation.options.sessionId]?.enabled === false &&
      forceSidecar().sessions?.[forceCreation.options.sessionId]?.enabled === true &&
      sidecar().enabled === false &&
      forceSidecar().enabled === true,
  )
  const forceHandle = forceCreation.handle
  const forceSession = forceHandle.agent.session

  // Enabling Smart again replaces ForceSmart in one fork.
  const smartAgainGate = gateNextCreate()
  const switchSmartAgain = channel.switchSmart(true)
  const smartAgainCreation = await withTimeout(smartAgainGate.entered, 'second switchSmart(true) agents.create')
  check(
    'Smart re-enable: ForceSmart handle stays active while one replacement is pending',
    forceHandle.disposeCalls === 0 && channel.smart === false && channel.forceSmart === true,
  )
  smartAgainGate.release()
  const smartAgainResult = await switchSmartAgain

  check('Smart re-enable: switchSmart(true) returns true', smartAgainResult === true)
  assertForkRequest('Smart re-enable', 2, forceSession)
  assertSuccessfulSwap('Smart re-enable', 2, forceHandle, originalRows, true, false)
  check(
    'Smart re-enable: setup contains Smart only',
    same(smartAgainCreation.agentCtx.pluginCalls.map(call => call.name), [
      'tool-str-replace-editor',
      'dsh-tui-smart-marker',
      'router-bootstrap',
    ]),
  )
  check(
    'Smart re-enable: both child sidecars reverse consistently at the session boundary',
    sidecar().sessions?.[smartAgainCreation.options.sessionId]?.enabled === true &&
      forceSidecar().sessions?.[smartAgainCreation.options.sessionId]?.enabled === false &&
      sidecar().enabled === true &&
      forceSidecar().enabled === false,
  )
  const smartAgainHandle = smartAgainCreation.handle
  const smartAgainSession = smartAgainHandle.agent.session

  // Smart off, still Standard.
  const offGate = gateNextCreate()
  const switchOff = channel.switchSmart(false)
  const offCreation = await withTimeout(offGate.entered, 'switchSmart(false) agents.create')
  check(
    'Smart off: Smart handle stays active while create is pending',
    smartAgainHandle.disposeCalls === 0 &&
      channel.agentId === smartAgainHandle.agent.id &&
      channel.smart === true &&
      channel.forceSmart === false,
  )
  offGate.release()
  const offResult = await switchOff

  check('Smart off: switchSmart(false) returns true', offResult === true)
  assertForkRequest('Smart off', 3, smartAgainSession)
  assertSuccessfulSwap('Smart off', 3, smartAgainHandle, originalRows, false, false)
  check(
    'Smart off: setup mounts Standard without Smart overlay plugins',
    offCreation.agentCtx.pluginCalls.length === 0 && host.hostPluginCalls.length === 1,
    JSON.stringify(offCreation.agentCtx.pluginCalls.map(call => call.name)),
  )
  check(
    'Smart off: child id is distinct from all earlier sessions',
    offCreation.options.sessionId !== initialSession.id && offCreation.options.sessionId !== onSession.id,
    String(offCreation.options.sessionId),
  )
  const offSidecar = sidecar()
  check(
    'Smart off: sidecar saves disabled child/default and retains prior Smart child',
    offSidecar.enabled === false &&
      offSidecar.sessions?.[offCreation.options.sessionId]?.enabled === false &&
      offSidecar.sessions?.[onCreation.options.sessionId]?.enabled === true,
    JSON.stringify(offSidecar),
  )

  // Failure after Standard + Smart setup: no swap and no sidecar write.
  const currentHandle = offCreation.handle
  const currentSession = currentHandle.agent.session
  const rowsBeforeFailure = transcriptOf(channel)
  const sidecarBeforeFailure = sidecarText()
  const forceSidecarBeforeFailure = forceSidecarText()
  rejectNextCreate = true
  const failureGate = gateNextCreate()
  const failedSwitch = channel.switchSmart(true)
  const failedCreation = await withTimeout(failureGate.entered, 'failed switchSmart(true) agents.create')

  check(
    'create failure: current Standard handle stays active while replacement is pending',
    currentHandle.disposeCalls === 0 &&
      channel.agentId === currentHandle.agent.id &&
      channel.agentPreset === 'standard' &&
      channel.smart === false,
  )
  failureGate.release()
  const failureResult = await failedSwitch

  check('create failure: switchSmart(true) returns false', failureResult === false)
  assertForkRequest('create failure', 4, currentSession)
  check(
    'create failure: factory rejected after Standard and Smart setup',
    failedCreation.setupCompleted === true &&
      failedCreation.rejected === true &&
      failedCreation.handle === undefined &&
      same(failedCreation.agentCtx.pluginCalls.map(call => call.name), ['tool-str-replace-editor', 'dsh-tui-smart-marker', 'router-bootstrap']),
    JSON.stringify(failedCreation.agentCtx.pluginCalls.map(call => call.name)),
  )
  check(
    'create failure: old handle is not disposed and channel keeps agent/preset/Smart state',
    currentHandle.disposeCalls === 0 &&
      currentHandle.disposed === false &&
      channel.agentId === currentHandle.agent.id &&
      channel.agentPreset === 'standard' &&
      channel.smart === false,
    `${currentHandle.disposeCalls}/${channel.agentId}/${channel.agentPreset}/smart=${channel.smart}`,
  )
  check(
    'create failure: transcript and trace remain attached to the old session',
    same(transcriptOf(channel), rowsBeforeFailure) && channel.traceEvents() === currentSession.events,
  )
  host.emit('agent/status', { agent: currentHandle.agent, status: 'running' })
  check('create failure: old agent status subscription remains live', channel.status === 'running')
  check(
    'create failure: enhancement sidecars are unchanged and contain no failed child',
    sidecarText() === sidecarBeforeFailure &&
      forceSidecarText() === forceSidecarBeforeFailure &&
      sidecar().sessions?.[failedCreation.options.sessionId] === undefined &&
      forceSidecar().sessions?.[failedCreation.options.sessionId] === undefined,
  )
  check(
    'create failure: successful predecessors were each disposed exactly once',
    initialHandle.disposeCalls === 1 &&
      onHandle.disposeCalls === 1 &&
      forceHandle.disposeCalls === 1 &&
      smartAgainHandle.disposeCalls === 1,
    `${initialHandle.disposeCalls}/${onHandle.disposeCalls}/${forceHandle.disposeCalls}/${smartAgainHandle.disposeCalls}`,
  )
  check(
    'create failure: error is reported without swapping',
    channel.notifications.some(notification => notification.text.includes('create failed for test')),
    JSON.stringify(channel.notifications.map(notification => notification.text)),
  )
  check(
    'all fork compositions resolved and mounted Standard without in-place recompose',
    same(resolveCalls, ['standard', 'standard', 'standard', 'standard', 'standard']) &&
      same(mountCalls.map(call => call.id), ['standard', 'standard', 'standard', 'standard', 'standard']) &&
      recomposeCalls.length === 0,
    JSON.stringify({ resolveCalls, mounts: mountCalls.map(call => call.id), recomposes: recomposeCalls.length }),
  )
} finally {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserProfile
  rmSync(testHome, { recursive: true, force: true })
}

if (failed > 0) {
  console.error(`\n${failed} Smart-fork check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll Smart-fork checks passed')
process.exit(0)
