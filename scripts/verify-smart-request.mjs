/**
 * Request-level regression for the orthogonal Smart enhancement.
 *
 * This verifier drives the real compiled DSH agent loop, session store,
 * system-prompt registry, tool runtime, and dsh-tui channel through:
 *
 *   Standard + Smart off -> Smart on -> Smart off -> Smart on
 *
 * The adapter captures each model request together with the live session's
 * request/header and deriveMessages() projection at the exact stream boundary.
 * The test-only dsh-agent-loop dependency supplies the real request engine.
 * DSH_AGENT_LOOP_ENTRY and a sibling deepseek-harness checkout remain useful
 * fallbacks while developing unreleased loop changes.
 *
 * Run after building dsh-tui:
 *   pnpm build
 *   node scripts/verify-smart-request.mjs
 */
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDir, '..')
const testHome = mkdtempSync(join(tmpdir(), 'dsh-tui-smart-request-'))
const workspace = join(testHome, 'workspace')
mkdirSync(workspace)

const isolatedEnvironment = ['HOME', 'USERPROFILE', 'DSH_HOME', 'DSH_SMART_RUNTIME_PATH']
const originalEnvironment = new Map(isolatedEnvironment.map(name => [name, process.env[name]]))
process.env.HOME = testHome
process.env.USERPROFILE = testHome
process.env.DSH_HOME = join(testHome, '.dsh')
delete process.env.DSH_SMART_RUNTIME_PATH

let failed = 0
let rootContext

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

function same(left, right) {
  return isDeepStrictEqual(left, right)
}

async function withTimeout(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 5000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function asEntryUrl(value) {
  if (value.startsWith('file:')) return value
  return pathToFileURL(isAbsolute(value) ? value : resolve(repositoryRoot, value)).href
}

function installedAgentLoop() {
  try {
    return import.meta.resolve('@deepseek-ai/dsh-agent-loop')
  } catch {
    return undefined
  }
}

function resolveAgentLoopEntry() {
  const candidates = [
    ...(process.env.DSH_AGENT_LOOP_ENTRY ? [asEntryUrl(process.env.DSH_AGENT_LOOP_ENTRY)] : []),
    installedAgentLoop(),
    pathToFileURL(resolve(repositoryRoot, '..', '..', 'deepseek-harness', 'packages', 'core', 'agent-loop', 'lib', 'index.js')).href,
  ].filter(Boolean)
  const found = candidates.find(url => url.startsWith('file:') && existsSync(fileURLToPath(url)))
  if (found !== undefined) return found
  throw new Error(
    'compiled @deepseek-ai/dsh-agent-loop not found; build a sibling deepseek-harness checkout '
      + 'or set DSH_AGENT_LOOP_ENTRY to its lib/index.js',
  )
}

function textResponse(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(callId, name, args) {
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name, arguments: argumentsJson },
    },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function toolNames(capture) {
  return capture.request.tools.map(tool => tool.name)
}

function headerEvents(capture) {
  return capture.events.filter(event => event.type === 'request/header')
}

function localHeader(capture) {
  const start = capture.meta.seedLength ?? 0
  return capture.events.findLast(event => event.type === 'request/header' && event.seq >= start)
}

function assertFullHeader(label, capture) {
  check(`${label}: adapter receives the session's effective request header`,
    capture.header !== undefined
      && capture.request.provider === capture.header.config.provider
      && capture.request.model === capture.header.config.model
      && capture.request.system === capture.header.system
      && same(capture.request.tools, capture.header.tools ?? []))
  check(`${label}: request messages equal deriveMessages() at dispatch`,
    same(capture.request.messages, capture.derived),
    `${capture.request.messages.length} messages`)
  check(`${label}: request/header records stay outside derived messages`,
    headerEvents(capture).length > 0
      && !JSON.stringify(capture.request.messages).includes('request/header'))
  check(`${label}: durable agentPreset remains Standard`, capture.meta.agentPreset === 'standard')
}

function assertForkSeed(label, capture, parentId, parentEvents) {
  const expectedSeedLength = parentEvents.length + 1
  check(`${label}: child records parentSession and complete seedLength`,
    capture.meta.parentSession === parentId
      && capture.meta.seedLength === expectedSeedLength,
    `${String(capture.meta.parentSession)} / ${String(capture.meta.seedLength)}`)
  check(`${label}: complete parent event log is the child seed prefix`,
    same(capture.events.slice(0, parentEvents.length), parentEvents),
    `${parentEvents.length} events`)
  check(`${label}: fork boundary is closed by session/end-seed`,
    capture.events[parentEvents.length]?.type === 'session/end-seed')
  const event = localHeader(capture)
  check(`${label}: replacement emits a child-local complete resume header`,
    event?.data.reason === 'resume'
      && event.seq >= expectedSeedLength
      && same(event.data.header, capture.header),
    event === undefined ? 'missing' : `${event.data.reason} at seq ${event.seq}`)
}

function restoreEnvironment() {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

try {
  const agentLoopEntry = resolveAgentLoopEntry()

  // The sibling bundle must use the exact rc.6 dependency instances installed
  // by dsh-tui. Otherwise two Cordis/DSH module graphs would make a passing
  // structural fake look more realistic than it is.
  const redirectedPackages = [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-scope',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/schemastery',
  ]
  const redirects = new Map(redirectedPackages.map(name => [name, import.meta.resolve(name)]))
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = redirects.get(specifier)
      return url === undefined ? nextResolve(specifier, context) : { url, shortCircuit: true }
    },
  })

  const [
    { Context },
    { default: LlmRuntime, LlmAdapter, CallId, createUserMessage },
    { default: SessionStore, SessionId },
    { default: SystemPrompt },
    { default: ToolRuntime, defineContentToolFixture },
    { default: AgentRegistry },
    { default: AgentLoop },
    { createChannel },
    { composePreset },
    { SMART_PROMPT_MARKER },
    { SUPER_INJECTOR_TOOL_NAMES },
  ] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-llm'),
    import('@deepseek-ai/dsh-session'),
    import('@deepseek-ai/dsh-system-prompt'),
    import('@deepseek-ai/dsh-tools'),
    import('@deepseek-ai/dsh-agent'),
    import(agentLoopEntry),
    import('../lib/types/channel.js'),
    import('../lib/types/presets.js'),
    import('../lib/types/smartPrefs.js'),
    import('../lib/types/smartRuntime.js'),
  ])

  const responses = [
    toolCallResponse(CallId('smart-request-bootstrap'), 'probe', {}),
    textResponse('Bootstrap complete.'),
    textResponse('Standard response.'),
    textResponse('Smart response.'),
    textResponse('Standard response after Smart.'),
    textResponse('Smart response after re-enable.'),
  ]

  class CapturingAdapter extends LlmAdapter {
    captures = []
    stage = 'bootstrap'

    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }

    async * stream(options) {
      const session = rootContext.sessions.get(options.sessionId)
      if (session === undefined) throw new Error(`request session ${String(options.sessionId)} is not live`)
      const response = responses.shift()
      if (response === undefined) throw new Error('capturing adapter response script exhausted')
      this.captures.push({
        stage: this.stage,
        request: {
          provider: options.provider,
          model: options.model,
          sessionId: String(options.sessionId),
          system: options.system ?? '',
          tools: structuredClone(options.tools ?? []),
          messages: structuredClone(options.messages),
        },
        header: structuredClone(session.requestHeader()),
        derived: structuredClone(session.deriveMessages()),
        events: structuredClone(session.events),
        meta: structuredClone(session.header),
      })
      for (const chunk of response) yield chunk
    }
  }

  const fixtureTool = name => defineContentToolFixture({
    name,
    description: `Request integration fixture: ${name}`,
    parameters: {},
    async execute() {
      return [{ type: 'text', text: `${name}: ok` }]
    },
  })

  const STANDARD = { id: 'standard', trust: 'system', name: 'Standard' }
  const DEFAULT_SENTINEL = { id: 'default-sentinel', trust: 'system', name: 'Default sentinel' }
  const BASE_TOOL_NAMES = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'probe']
  const ROUTER_TOOL_NAMES = ['dev_router_status', 'dev_router_mode', 'dev_mode_subagent']

  rootContext = new Context()
  rootContext.provide('loader', Object.freeze({}))
  rootContext.provide('timer', Object.freeze({}))
  rootContext.provide('fs', Object.freeze({ sandboxMode: undefined }))
  await rootContext.plugin(LlmRuntime)
  await rootContext.plugin(SessionStore)
  await rootContext.plugin(SystemPrompt, { persona: 'Host persona that Standard shadows.' })
  await rootContext.plugin(ToolRuntime)
  await rootContext.plugin(AgentRegistry)
  await rootContext.plugin(AgentLoop, { agents: [] })

  const mountCalls = []
  const resolveCalls = []
  const recomposeCalls = []
  rootContext.provide('agentPresets', {
    // A non-Standard default makes an accidental undefined preset observable.
    defaultId: 'default-sentinel',
    async list() {
      return [DEFAULT_SENTINEL, STANDARD]
    },
    async resolve(id = 'default-sentinel') {
      resolveCalls.push(id)
      if (id === 'standard') return STANDARD
      if (id === 'default-sentinel') return DEFAULT_SENTINEL
      throw new Error(`unknown agent preset: ${id}`)
    },
    async mount(agentContext, id = 'default-sentinel') {
      mountCalls.push({ agentContext, id })
      if (id !== 'standard') {
        agentContext.systemPrompt.section({
          name: 'deployment:persona',
          order: 0,
          text: 'Sentinel preset must never be mounted by a Smart replacement.',
        })
        agentContext.tools.register(fixtureTool('sentinel_tool'))
        return DEFAULT_SENTINEL
      }
      agentContext.systemPrompt.section({
        name: 'deployment:persona',
        order: 0,
        text: 'Standard request-integration persona.',
      })
      for (const name of BASE_TOOL_NAMES) agentContext.tools.register(fixtureTool(name))
      return STANDARD
    },
    async recompose(agentContext, id) {
      recomposeCalls.push({ agentContext, id })
      throw new Error('Smart request transitions must fork, not recompose')
    },
  })

  const adapter = new CapturingAdapter()
  rootContext.llm.registerAdapter(['request-test'], adapter)

  const initialComposition = await composePreset(rootContext, 'standard', false)
  const initialHandle = await rootContext.agents.create({
    sessionId: SessionId('smart-request-standard'),
    meta: {
      cwd: workspace,
      ...(initialComposition.agentPreset === undefined
        ? {}
        : { agentPreset: initialComposition.agentPreset }),
    },
    agentOptions: { provider: 'request-test', model: 'request-model' },
    ...(initialComposition.setup === undefined ? {} : { setup: initialComposition.setup }),
  })

  // Prime one real durable tool/call so Router Standard is in its promoted
  // catalog state. The three captures under test then remain one model request
  // each while still proving the Router management tools are assembled.
  initialHandle.agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Create the bootstrap fixture.' }],
    source: { kind: 'user' },
  }))
  await initialHandle.agent.whenIdle()
  check('bootstrap: real agent loop executes one tool call and follow-up request',
    adapter.captures.filter(capture => capture.stage === 'bootstrap').length === 2
      && initialHandle.agent.session.events.some(event => event.type === 'tool/call'))

  // Force a new Standard header after bootstrap, so every state under test has
  // a request-local header produced by an actual assembly.
  rootContext.tools.register(fixtureTool('epoch_probe'))

  const channel = createChannel(rootContext, initialHandle.agent, {
    model: 'request-model',
    provider: 'request-test',
    cwd: workspace,
    agentPreset: 'standard',
    smart: false,
    activity: false,
    contextBar: false,
    handle: initialHandle,
  })

  async function captureTurn(stage, text) {
    const before = adapter.captures.length
    adapter.stage = stage
    const live = rootContext.agents.get(SessionId(channel.agentId))
    if (live === undefined) throw new Error(`${stage}: channel agent is not live`)
    const started = Promise.withResolvers()
    const disposeStatus = rootContext.on('agent/status', ({ agent, status }) => {
      if (agent === live && status === 'running') started.resolve()
    })
    channel.submit(text)
    await withTimeout(started.promise, `${stage} turn start`)
    disposeStatus()
    await live.whenIdle()
    const captures = adapter.captures.slice(before).filter(capture => capture.stage === stage)
    if (captures.length !== 1) {
      const tail = live.session.events.slice(-8).map(event =>
        `${event.seq}:${event.type}${event.type === 'turn/end' ? `:${JSON.stringify(event.data.reason)}` : ''}`)
      throw new Error(
        `${stage}: expected one model request, captured ${captures.length}; `
          + `capture stages=[${adapter.captures.slice(before).map(capture => capture.stage).join(', ')}]; `
          + `event tail=[${tail.join(', ')}]`,
      )
    }
    return captures[0]
  }

  const standard = await captureTurn('standard-off-before', 'Continue in Standard without Smart.')
  assertFullHeader('Standard before Smart', standard)
  const standardTools = toolNames(standard)
  check('Standard before Smart: no Smart marker', !standard.request.system.includes(SMART_PROMPT_MARKER))
  check('Standard before Smart: base catalog is present',
    [...BASE_TOOL_NAMES, 'epoch_probe'].every(name => standardTools.includes(name)))
  check('Standard before Smart: Router and optional host management tools are absent',
    ROUTER_TOOL_NAMES.every(name => !standardTools.includes(name))
      && SUPER_INJECTOR_TOOL_NAMES.every(name => !standardTools.includes(name))
      && !standardTools.includes('dev_smart_status'))
  check('Standard before Smart: changed assembly emits a complete change header',
    standard.events.findLast(event => event.type === 'request/header')?.data.reason === 'change')

  // Stand in for tools registered by a verified optional host payload. They are
  // global by upstream design; SmartRuntime's real assembly filter must remove
  // every known management name again after Smart is disabled.
  for (const name of SUPER_INJECTOR_TOOL_NAMES) rootContext.tools.register(fixtureTool(name))

  const standardParentId = channel.agentId
  const standardParent = rootContext.agents.get(SessionId(standardParentId))
  if (standardParent === undefined) throw new Error('Standard parent disappeared before Smart switch')
  const standardParentEvents = structuredClone(standardParent.session.events)
  check('Smart on: channel forks a replacement', await channel.switchSmart(true))
  check('Smart on: enhancement state changes without changing agentPreset',
    channel.smart === true && channel.agentPreset === 'standard')

  const smart = await captureTurn('smart-on', 'Continue with the Smart enhancement.')
  assertFullHeader('Smart on', smart)
  assertForkSeed('Smart on', smart, standardParentId, standardParentEvents)
  const smartTools = toolNames(smart)
  check('Smart on: complete system prompt is reassembled with the marker',
    smart.request.system.includes(SMART_PROMPT_MARKER)
      && smart.request.system !== standard.request.system)
  check('Smart on: Router management tools are present after durable promotion',
    ROUTER_TOOL_NAMES.every(name => smartTools.includes(name)), smartTools.join(', '))
  check('Smart on: base Standard catalog remains available',
    [...BASE_TOOL_NAMES, 'epoch_probe'].every(name => smartTools.includes(name)))
  check('Smart on: Router v0.2 Standard interface adds str_replace_editor',
    smartTools.includes('str_replace_editor'))
  check('Smart on: optional host management surface and status tool are visible',
    SUPER_INJECTOR_TOOL_NAMES.every(name => smartTools.includes(name))
      && smartTools.includes('dev_smart_status'))
  check('Smart on: Standard request messages are an exact seed prefix',
    smart.request.messages.length > standard.request.messages.length
      && same(smart.request.messages.slice(0, standard.request.messages.length), standard.request.messages))

  const smartParentId = channel.agentId
  const smartParent = rootContext.agents.get(SessionId(smartParentId))
  if (smartParent === undefined) throw new Error('Smart parent disappeared before disable')
  const smartParentEvents = structuredClone(smartParent.session.events)
  check('Smart off: channel forks another replacement', await channel.switchSmart(false))
  check('Smart off: enhancement state changes without changing agentPreset',
    channel.smart === false && channel.agentPreset === 'standard')

  const standardAgain = await captureTurn('standard-off-after', 'Continue in Standard after Smart.')
  assertFullHeader('Standard after Smart', standardAgain)
  assertForkSeed('Smart off', standardAgain, smartParentId, smartParentEvents)
  const standardAgainTools = toolNames(standardAgain)
  check('Standard after Smart: marker is absent from the rebuilt system prompt',
    !standardAgain.request.system.includes(SMART_PROMPT_MARKER))
  check('Standard after Smart: Router tools are absent',
    ROUTER_TOOL_NAMES.every(name => !standardAgainTools.includes(name)))
  check('Standard after Smart: every optional host management tool is filtered',
    SUPER_INJECTOR_TOOL_NAMES.every(name => !standardAgainTools.includes(name))
      && !standardAgainTools.includes('dev_smart_status'))
  check('Standard after Smart: native Standard tools remain usable',
    [...BASE_TOOL_NAMES, 'epoch_probe'].every(name => standardAgainTools.includes(name)))
  check('Standard after Smart: Smart-only editor is absent',
    !standardAgainTools.includes('str_replace_editor'))
  check('Standard after Smart: system prompt and tool surface restore exactly',
    standardAgain.request.system === standard.request.system
      && same(standardAgainTools, standardTools))
  check('Standard after Smart: Smart request messages are an exact seed prefix',
    standardAgain.request.messages.length > smart.request.messages.length
      && same(standardAgain.request.messages.slice(0, smart.request.messages.length), smart.request.messages))
  check('Standard after Smart: inherited Smart headers never become model messages',
    headerEvents(standardAgain).some(event => event.data.header.system?.includes(SMART_PROMPT_MARKER))
      && !JSON.stringify(standardAgain.request.messages).includes(SMART_PROMPT_MARKER))

  const standardAgainParentId = channel.agentId
  const standardAgainParent = rootContext.agents.get(SessionId(standardAgainParentId))
  if (standardAgainParent === undefined) throw new Error('Standard parent disappeared before Smart re-enable')
  const standardAgainParentEvents = structuredClone(standardAgainParent.session.events)
  check('Smart re-enable: channel forks a replacement', await channel.switchSmart(true))
  check('Smart re-enable: state changes without changing agentPreset',
    channel.smart === true && channel.agentPreset === 'standard')

  const smartAgain = await captureTurn('smart-on-again', 'Continue after re-enabling Smart.')
  assertFullHeader('Smart after re-enable', smartAgain)
  assertForkSeed('Smart re-enable', smartAgain, standardAgainParentId, standardAgainParentEvents)
  const smartAgainTools = toolNames(smartAgain)
  check('Smart re-enable: marker and complete Smart surface are restored exactly',
    smartAgain.request.system === smart.request.system
      && same(smartAgainTools, smartTools))
  check('Smart re-enable: Standard request messages are an exact seed prefix',
    smartAgain.request.messages.length > standardAgain.request.messages.length
      && same(
        smartAgain.request.messages.slice(0, standardAgain.request.messages.length),
        standardAgain.request.messages,
      ))

  check('all four requests keep the same provider/model route',
    [standard, smart, standardAgain, smartAgain].every(capture =>
      capture.request.provider === 'request-test' && capture.request.model === 'request-model'))
  check('Smart transitions never use preset recompose', recomposeCalls.length === 0)
  check('every composition resolves the source preset explicitly',
    same(resolveCalls, ['standard', 'standard', 'standard', 'standard']),
    resolveCalls.join(', '))
  check('base Standard mount runs once per agent and never falls back to the roster default',
    mountCalls.length === 4 && mountCalls.every(call => call.id === 'standard'),
    mountCalls.map(call => call.id).join(', '))
  check('Smart preference writes are isolated under the temporary HOME',
    existsSync(join(testHome, '.dsh-cc', 'smart.json')))
  check('adapter consumed the exact scripted request count', responses.length === 0)
} catch (error) {
  failed += 1
  console.error(`FAIL: Smart request integration threw\n${error instanceof Error ? error.stack : String(error)}`)
} finally {
  if (rootContext !== undefined) {
    try {
      await rootContext.fiber.dispose()
    } catch (error) {
      failed += 1
      console.error(`FAIL: root context cleanup threw (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  restoreEnvironment()
  rmSync(testHome, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? 'All Smart request integration checks passed.' : `${failed} Smart request integration check(s) failed.`}`)
if (failed > 0) process.exitCode = 1
