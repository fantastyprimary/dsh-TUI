import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { apply } from '../force-smart-assets/force-bootstrap.mjs'
import {
  apply as applyWindowsBash,
  isWindowsSubsystemLauncher,
  resolveWindowsBash,
  windowsBashCandidates,
} from '../force-smart-assets/windows-bash.mjs'

const BOOTSTRAP_MAX_TOKENS = 1024
const assetRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'force-smart-assets')

test('ForceSmart provenance and asset hashes remain pinned', () => {
  const manifest = JSON.parse(readFileSync(join(assetRoot, 'manifest.json'), 'utf8'))
  assert.equal(manifest.enhancement.id, 'force-smart')
  assert.equal(manifest.enhancement.displayName, 'ForceSmart')
  assert.equal(
    manifest.enhancement.sources.anchoredStandard.sha,
    'd97bec91a3d668f4cf1d03ee5f20aae84fb6f85c',
  )
  assert.equal(
    manifest.enhancement.sources.liangshenReference.sha,
    '3647a33fa467e0335260468614f6eed04b196c38',
  )
  assert.equal(
    manifest.enhancement.sources.liangshenReference.latestReviewedSha,
    '3647a33fa467e0335260468614f6eed04b196c38',
  )
  assert.equal(manifest.enhancement.sources.liangshenReference.latestReviewedAt, '2026-08-16')
  assert.match(manifest.enhancement.sources.liangshenReference.role, /not a ForceSmart product name or alias/)
  assert.deepEqual(
    manifest.enhancement.upstreamReview.map(item => [item.ref, item.decision]),
    [
      ['dsh-web-ui@3647a33', 'current-no-new-merged-behavior'],
      ['dsh-web-ui#253', 'fail-open-covered-compaction-reset-excluded'],
      ['dsh-web-ui#205', 'not-applicable-to-packaged-assets'],
      ['dsh-anchored-standard#15', 'patched-for-delegated-children'],
    ],
  )
  for (const [file, expected] of Object.entries(manifest.enhancement.files)) {
    const actual = createHash('sha256').update(readFileSync(join(assetRoot, file))).digest('hex')
    assert.equal(actual, expected, file)
  }
})

test('Windows Bash discovery prefers Git installations and permits an explicit override', () => {
  const environment = {
    ProgramFiles: String.raw`C:\Program Files`,
    'ProgramFiles(x86)': String.raw`C:\Program Files (x86)`,
    LOCALAPPDATA: String.raw`C:\Users\tester\AppData\Local`,
  }
  assert.deepEqual(windowsBashCandidates({}, environment), [
    String.raw`C:\Program Files\Git\bin\bash.exe`,
    String.raw`C:\Program Files\Git\usr\bin\bash.exe`,
    String.raw`C:\Program Files (x86)\Git\bin\bash.exe`,
    String.raw`C:\Program Files (x86)\Git\usr\bin\bash.exe`,
    String.raw`C:\Users\tester\AppData\Local\Programs\Git\bin\bash.exe`,
    String.raw`C:\Users\tester\AppData\Local\Programs\Git\usr\bin\bash.exe`,
    'bash',
  ])
  assert.deepEqual(
    windowsBashCandidates({ bashPath: String.raw`D:\PortableGit\bin\bash.exe` }, environment),
    [String.raw`D:\PortableGit\bin\bash.exe`],
  )
})

test('Windows Bash discovery rejects the WSL launcher and continues to Git Bash', async () => {
  const attempts = []
  const subprocess = {
    async resolveExecutable(candidate) {
      attempts.push(candidate)
      if (candidate.endsWith(String.raw`Git\bin\bash.exe`)) {
        return String.raw`C:\Windows\System32\bash.exe`
      }
      if (candidate.endsWith(String.raw`Git\usr\bin\bash.exe`)) return candidate
      throw new Error('missing')
    },
  }
  const resolved = await resolveWindowsBash(subprocess, {}, {
    ProgramFiles: String.raw`C:\Program Files`,
  })
  assert.equal(resolved, String.raw`C:\Program Files\Git\usr\bin\bash.exe`)
  assert.deepEqual(attempts, [
    String.raw`C:\Program Files\Git\bin\bash.exe`,
    String.raw`C:\Program Files\Git\usr\bin\bash.exe`,
  ])
  assert.equal(isWindowsSubsystemLauncher(String.raw`C:\Windows\System32\bash.exe`), true)
  assert.equal(isWindowsSubsystemLauncher(String.raw`C:\Program Files\Git\bin\bash.exe`), false)
})

test('Windows Bash is a real bash -c executor scoped to the session cwd', async () => {
  let definition
  let spawnSpec
  const signal = new AbortController().signal
  const ctx = {
    subprocess: {
      async resolveExecutable(candidate) {
        assert.equal(candidate, String.raw`D:\Git\bin\bash.exe`)
        return candidate
      },
      spawn(spec) {
        spawnSpec = spec
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: 'stdout', nextOffset: 6, lossy: false }) },
            stderr: { readFrom: () => ({ text: 'stderr', nextOffset: 6, lossy: false }) },
          },
        }
      },
    },
    tools: {
      register(value) { definition = value },
    },
  }
  await applyWindowsBash(ctx, {
    bashPath: String.raw`D:\Git\bin\bash.exe`,
    timeoutMs: 123_000,
    maxOutputBytes: 12_345,
  })
  assert.equal(definition.name, 'bash')
  assert.match(definition.description, /Git Bash on Windows/)
  assert.match(definition.description, /without OS sandbox confinement/)
  assert.equal(definition.timeoutMs, 123_000)
  assert.deepEqual(definition.parameters, {
    command: {
      type: 'string',
      required: true,
      description: 'The bash command to run. Relative path is preferred in the command.',
    },
  })

  const result = await definition.execute(
    { command: 'printf test' },
    {
      signal,
      agent: { session: { header: { cwd: String.raw`C:\workspace` } } },
    },
  )
  assert.deepEqual(result, { text: 'stdout\nstderr' })
  assert.deepEqual(spawnSpec, {
    argv: [String.raw`D:\Git\bin\bash.exe`, '-c', 'printf test'],
    cwd: String.raw`C:\workspace`,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 12_345 },
      stderr: { maxBytes: 12_345 },
    },
    graceMs: 3_000,
    signal,
  })
})

test('Windows Bash fails before registration when no real executor exists', async () => {
  let registered = false
  await assert.rejects(
    applyWindowsBash({
      subprocess: {
        async resolveExecutable() { throw new Error('not found') },
      },
      tools: {
        register() { registered = true },
      },
    }, { bashPath: String.raw`Z:\missing\bash.exe` }),
    /Git Bash executable unavailable/,
  )
  assert.equal(registered, false)
})

function createHarness({ id = 'force-smart', seedLength = 0, config = {}, ...header } = {}) {
  const listeners = new Map()
  const rootListeners = new Map()
  const options = new Map()
  const session = {
    header: { id, seedLength, ...header },
    events: [],
  }
  const agent = { session }
  const ctx = {
    agent,
    root: {
      on(event, listener) {
        rootListeners.set(event, listener)
        return () => rootListeners.delete(event)
      },
    },
    effect(register) { return register() },
    on(event, listener, hookOptions) {
      assert.equal(listeners.has(event), false, `duplicate listener for ${event}`)
      listeners.set(event, listener)
      options.set(event, hookOptions)
      return () => listeners.delete(event)
    },
  }

  apply(ctx, config)
  return { agent, listeners, options, rootListeners, session }
}

function fullAssembly(overrides = {}) {
  return {
    sections: [
      { name: 'deployment:persona', text: 'base persona' },
      { name: 'tool:guidance', text: 'base guidance' },
    ],
    contexts: [
      { name: 'sandbox:policy', text: 'workspace-write' },
      { name: 'approval:policy', text: 'ask' },
    ],
    tools: [
      { name: 'bash' },
      { name: 'str_replace_editor' },
      { name: 'read' },
      { name: 'subagent' },
      { name: 'subagent_fork' },
      { name: 'workflow' },
    ],
    ...overrides,
  }
}

function toolCall(name = 'bash') {
  return { type: 'tool/call', data: { name } }
}

function anchoredAssistant() {
  return {
    type: 'assistant/message',
    data: {
      message: {
        content: [{ type: 'reasoning', text: 'We should inspect the result before continuing.' }],
      },
    },
  }
}

function activeGoalChange() {
  return {
    kind: 'goal/change',
    version: 1,
    operation: 'create',
    goal: {
      id: 'force-smart-goal',
      revision: 1,
      objective: 'Exercise ForceSmart goal compatibility',
      phase: 'active',
      maxGoalRounds: 3,
    },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

async function assemble(harness, assembled) {
  return harness.listeners.get('system-prompt/assemble')(
    undefined,
    { agent: harness.agent },
    async () => assembled,
  )
}

async function preStep(harness, decision) {
  return harness.listeners.get('agent/pre-step')(
    { agent: harness.agent },
    async () => decision,
  )
}

async function request(harness, resolved) {
  return harness.listeners.get('agent/request')(
    { agent: harness.agent },
    async () => resolved,
  )
}

test('fresh ForceSmart bootstrap aligns its system prompt to Minimal', async () => {
  const harness = createHarness({ id: 'fresh' })
  assert.deepEqual([...harness.listeners.keys()].sort(), [
    'agent/pre-step',
    'agent/request',
    'system-prompt/assemble',
  ])
  for (const event of harness.listeners.keys()) {
    assert.deepEqual(harness.options.get(event), { prepend: true }, event)
  }

  const result = await assemble(harness, fullAssembly())
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])
  assert.match(result.tools[0].description, /^Run commands in a bash shell\n/)
  assert.deepEqual(result.tools[0].parameters, {
    command: {
      type: 'string',
      required: true,
      description: 'The bash command to run. Relative path is preferred in the command.',
    },
  })
  assert.match(result.tools[1].description, /^Custom editing tool for viewing, creating and editing files\n/)
  assert.deepEqual(result.tools[1].parameters.command.enum, ['view', 'create', 'str_replace', 'insert'])
  assert.equal(result.tools[1].parameters.path.required, true)
  assert.deepEqual(result.contexts, [])
  assert.deepEqual(result.sections, [
    {
      name: 'persona',
      order: 0,
      text: 'You are a helpful software engineer assistant.',
      complete: true,
    },
  ])

  const retained = { source: { kind: 'user' }, content: 'keep' }
  const decision = {
    kind: 'enter',
    messages: [
      { source: { kind: 'agent-instructions' }, content: 'defer instructions' },
      retained,
      { source: { kind: 'skill-catalog' }, content: 'defer skills' },
    ],
  }
  const filtered = await preStep(harness, decision)
  assert.deepEqual(filtered.messages, [retained])
})

test('the permanent tool:goal section does not masquerade as an active goal', async () => {
  const harness = createHarness({ id: 'tool-goal-section' })
  const assembled = fullAssembly()
  assembled.sections.push({ name: 'tool:goal', text: 'Goal tool usage guidance.' })

  const result = await assemble(harness, assembled)
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])
  assert.deepEqual(result.contexts, [])
  assert.deepEqual(result.sections, [
    {
      name: 'persona',
      order: 0,
      text: 'You are a helpful software engineer assistant.',
      complete: true,
    },
  ])
})

test('an active plan promotes immediately and preserves the downstream assembly', async () => {
  const harness = createHarness({ id: 'active-plan' })
  const assembled = fullAssembly({
    sections: [
      { name: 'deployment:persona', text: 'base persona' },
      { name: 'plan:policy', text: 'active plan' },
    ],
  })

  assert.equal(await assemble(harness, assembled), assembled)
})

test('enhancement-owned bootstrap tools disappear from the promoted base surface', async () => {
  const harness = createHarness({
    id: 'owned-bootstrap-tools',
    config: { ownedTools: ['str_replace_editor'] },
  })
  harness.session.events.push(anchoredAssistant())
  const assembled = fullAssembly()
  const result = await assemble(harness, assembled)

  assert.deepEqual(
    result.tools.map(tool => tool.name),
    ['bash', 'read', 'subagent', 'subagent_fork', 'workflow'],
  )
  assert.deepEqual(result.sections, assembled.sections)
  assert.deepEqual(result.contexts, assembled.contexts)
})

test('a real goal/change active event fails open with the downstream assembly', async () => {
  const harness = createHarness({ id: 'active-goal' })
  harness.session.events.push({
    type: 'goal/change',
    seq: 0,
    data: activeGoalChange(),
  })
  const assembled = fullAssembly()

  assert.equal(await assemble(harness, assembled), assembled)
})

test('a tool call plus anchored reasoning restores all downstream tools', async () => {
  const harness = createHarness({ id: 'anchored-promotion' })
  const initial = await assemble(harness, fullAssembly())
  assert.deepEqual(initial.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])

  harness.session.events.push(toolCall())
  const afterTool = await assemble(harness, fullAssembly())
  assert.deepEqual(afterTool.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])

  harness.session.events.push(anchoredAssistant())
  const assembled = fullAssembly()
  const promoted = await assemble(harness, assembled)
  assert.equal(promoted, assembled)
  assert.deepEqual(promoted.tools.map(tool => tool.name), [
    'bash',
    'str_replace_editor',
    'read',
    'subagent',
    'subagent_fork',
    'workflow',
  ])

  const decision = {
    kind: 'enter',
    messages: [
      { source: { kind: 'agent-instructions' }, content: 'restored instructions' },
      { source: { kind: 'skill-catalog' }, content: 'restored skills' },
    ],
  }
  assert.equal(await preStep(harness, decision), decision)
})

test('a tool-less first response promotes the next turn', async () => {
  const harness = createHarness({ id: 'tool-less-response' })
  const initial = await assemble(harness, fullAssembly())
  assert.deepEqual(initial.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])

  harness.session.events.push({
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'The answer is complete.' }] } },
  })
  const assembled = fullAssembly()
  assert.equal(await assemble(harness, assembled), assembled)
})

test('a seed containing only session/end-seed still bootstraps', async () => {
  const harness = createHarness({ id: 'empty-seed', seedLength: 1 })
  harness.session.events.push({ type: 'session/end-seed', seq: 0 })

  const result = await assemble(harness, fullAssembly())
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])
  assert.deepEqual(result.contexts, [])
  assert.deepEqual(result.sections, [
    {
      name: 'persona',
      order: 0,
      text: 'You are a helpful software engineer assistant.',
      complete: true,
    },
  ])
})

for (const [id, event] of [
  ['tool-call', { ...toolCall(), seq: 0 }],
  ['assistant-message', { ...anchoredAssistant(), seq: 0 }],
]) {
  test(`meaningful inherited ${id} history starts promoted`, async () => {
    const harness = createHarness({ id: `inherited-${id}`, seedLength: 2 })
    harness.session.events.push(event, { type: 'session/end-seed', seq: 1 })
    const assembled = fullAssembly()
    assert.equal(await assemble(harness, assembled), assembled)
  })
}

test('bootstrap maxTokens restores an originally absent base value', async () => {
  const harness = createHarness({ id: 'undefined-max-tokens' })
  const base = { provider: 'provider', model: 'model' }
  const bootstrap = await request(harness, base)
  assert.equal(bootstrap.maxTokens, BOOTSTRAP_MAX_TOKENS)
  assert.equal(Object.hasOwn(base, 'maxTokens'), false)

  harness.session.events.push(toolCall(), anchoredAssistant())
  const inheritedBootstrap = { ...base, maxTokens: BOOTSTRAP_MAX_TOKENS }
  const restored = await request(harness, inheritedBootstrap)
  assert.deepEqual(restored, base)
  assert.equal(Object.hasOwn(restored, 'maxTokens'), false)
})

test('bootstrap maxTokens preserves a native base value of 1024', async () => {
  const harness = createHarness({ id: 'native-max-tokens' })
  const base = { provider: 'provider', model: 'model', maxTokens: BOOTSTRAP_MAX_TOKENS }
  const bootstrap = await request(harness, base)
  assert.equal(bootstrap.maxTokens, BOOTSTRAP_MAX_TOKENS)

  harness.session.events.push(toolCall(), anchoredAssistant())
  const restored = await request(harness, { ...base })
  assert.equal(Object.hasOwn(restored, 'maxTokens'), true)
  assert.equal(restored.maxTokens, BOOTSTRAP_MAX_TOKENS)
})

test('a promoted resume drops the inherited ForceSmart bootstrap cap', async () => {
  const harness = createHarness({ id: 'promoted-resume', seedLength: 3 })
  harness.session.events.push(
    {
      type: 'request/header',
      seq: 0,
      data: {
        reason: 'start',
        header: {
          system: 'You are a helpful software engineer assistant.',
          config: {
            provider: 'provider',
            model: 'model',
            maxTokens: BOOTSTRAP_MAX_TOKENS,
          },
          tools: [{ name: 'bash' }, { name: 'str_replace_editor' }],
        },
      },
    },
    { ...anchoredAssistant(), seq: 1 },
    { type: 'session/end-seed', seq: 2 },
  )

  const assembled = fullAssembly()
  assert.equal(await assemble(harness, assembled), assembled)

  const restored = await request(harness, {
    provider: 'provider',
    model: 'model',
    maxTokens: BOOTSTRAP_MAX_TOKENS,
  })
  assert.deepEqual(restored, { provider: 'provider', model: 'model' })
  assert.equal(Object.hasOwn(restored, 'maxTokens'), false)
})

test('a delegationDepth child starts promoted with its complete delegated surface', async () => {
  const harness = createHarness({
    id: 'compatibility-child',
    parentSession: 'parent-session',
    delegationDepth: 1,
  })
  const assembled = fullAssembly({
    sections: [
      { name: 'persona', text: 'Delegated specialist persona.' },
      { name: 'child:policy', text: 'Stay within the delegated task.' },
    ],
    contexts: [
      { name: 'sandbox:policy', text: 'workspace-write' },
      { name: 'delegation:policy', text: 'Report only to the parent.' },
    ],
    tools: [
      { name: 'bash' },
      { name: 'str_replace_editor' },
      { name: 'read' },
      { name: 'subagent' },
    ],
  })

  const result = await assemble(harness, assembled)
  assert.equal(result, assembled)
  assert.equal(await request(harness, { provider: 'provider', model: 'model' }).maxTokens, undefined)
})

test('a shell-less child keeps its restricted tools, messages, and request config', async () => {
  const harness = createHarness({
    id: 'shell-less-child',
    parentSession: 'parent-session',
    delegationDepth: 1,
  })
  const assembled = fullAssembly({
    sections: [{ name: 'child:policy', text: 'restricted child' }],
    contexts: [{ name: 'child:context', text: 'scoped' }],
    tools: [{ name: 'memory_read' }, { name: 'subagent' }],
  })
  assert.equal(await assemble(harness, assembled), assembled)

  const decision = {
    kind: 'enter',
    messages: [
      { source: { kind: 'agent-instructions' }, content: 'child instructions' },
      { source: { kind: 'skill-catalog' }, content: 'child skills' },
    ],
  }
  assert.equal(await preStep(harness, decision), decision)

  const resolved = { provider: 'provider', model: 'child-model', maxTokens: 4096 }
  assert.equal(await request(harness, resolved), resolved)
})
