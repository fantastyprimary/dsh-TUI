import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { apply as applyRouter } from '../smart-assets/router-standard/router-bootstrap.mjs'
import {
  applyPersona,
  bandFor,
  classifyTask,
  coreFor,
  extractText,
  isFlashModel,
  parseMode,
  personaFor,
  sessionMode,
  testinessFor,
} from '../smart-assets/router-standard/router-core.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(root, 'smart-assets')
const routerRoot = join(sourceRoot, 'router-standard')
const manifest = JSON.parse(readFileSync(join(sourceRoot, 'manifest.json'), 'utf8'))

test('smart is packaged as an enhancement asset, not a roster preset', () => {
  assert.deepEqual(Object.keys(manifest.enhancements), ['smart'])
  assert.equal(manifest.presets, undefined)
  assert.deepEqual(readdirSync(routerRoot).sort(), [
    'LICENSE',
    'NOTICE',
    'agent.cordis.yml',
    'preset.yml',
    'router-bootstrap.mjs',
    'router-core.mjs',
  ])

  assert.equal(manifest.enhancements.smart.sources.router.sha, '9cacc362abc0b92fe3aaf574739d5c565fe87249')
  assert.equal(manifest.enhancements.smart.sources.injector.vendored, false)
  assert.deepEqual(
    manifest.enhancements.smart.upstreamReview.decisions.map(item => item.ref),
    ['dsh-routing-suite#11', 'dsh-routing-suite#6', 'dsh-routing-suite#10', 'dsh-routing-suite#1'],
  )

  for (const [file, expected] of Object.entries(manifest.enhancements.smart.sources.router.files)) {
    const actual = createHash('sha256').update(readFileSync(join(routerRoot, file))).digest('hex')
    assert.equal(actual, expected, file)
  }
})

// These 15 cases mirror router.test.mjs at the router SHA pinned in manifest.json.
test('upstream router-core 1/15: build tasks map to react', () => {
  assert.equal(bandFor(classifyTask('\u{9700}\u{8981}\u{672c}\u{5730}\u{5f00}\u{53d1}\u{4e00}\u{4e2a}\u{9a6c}\u{91cc}\u{5965}\u{7f51}\u{9875}\u{5c0f}\u{6e38}\u{620f}\u{ff0c}\u{53c2}\u{8003}\u{7ecf}\u{5178}\u{539f}\u{7248}')), 'react')
  assert.equal(bandFor(classifyTask('\u{5e2e}\u{6211}\u{5199}\u{4e00}\u{4e2a} Python \u{811a}\u{672c}\u{5904}\u{7406} CSV')), 'react')
  assert.equal(bandFor(classifyTask('\u{4ece}\u{96f6}\u{642d}\u{5efa}\u{4e00}\u{4e2a}\u{7f51}\u{7ad9}')), 'react')
})

test('upstream router-core 2/15: fix tasks map to spec', () => {
  const fix = '\u{4fee}\u{590d}\u{8fd9}\u{4e2a}\u{4ed3}\u{5e93}\u{91cc}\u{7684} bug'
  assert.equal(bandFor(classifyTask(fix)), 'spec')
  assert.equal(bandFor(classifyTask('\u{4e3a}\u{4ec0}\u{4e48}\u{767b}\u{5f55}\u{4e00}\u{76f4}\u{62a5}\u{9519}\u{ff0c}\u{5e2e}\u{6211}\u{6392}\u{67e5}')), 'spec')
  assert.equal(classifyTask(fix), 0)
})

test('upstream router-core 3/15: net build evidence maps to react', () => {
  assert.equal(bandFor(classifyTask('\u{5e2e}\u{6211}\u{5f00}\u{53d1}\u{4e00}\u{4e2a}\u{5c0f}\u{6e38}\u{620f}\u{7136}\u{540e}\u{4fee}\u{590d}\u{91cc}\u{9762}\u{7684} bug')), 'react')
})

test('upstream router-core 4/15: unmatched tasks default to weak', () => {
  assert.equal(classifyTask('\u{4eca}\u{5929}\u{5929}\u{6c14}\u{600e}\u{4e48}\u{6837}'), 'weak')
  assert.equal(bandFor('weak'), 'weak')
})

test('upstream router-core 5/15: ties default to weak', () => {
  assert.equal(classifyTask('\u{5e2e}\u{6211}\u{5f00}\u{53d1}\u{4e00}\u{4e2a}\u{5c0f}\u{6e38}\u{620f}\u{7136}\u{540e}\u{4fee}\u{590d}\u{91cc}\u{9762}\u{7684} bug'), 1)
  assert.equal(classifyTask('\u{5f00}\u{53d1}\u{5e76}\u{4fee}\u{590d}'), 'weak')
})

test('upstream router-core 6/15: nested user messages still classify', () => {
  const nested = {
    message: {
      kind: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: '\u{628a}\u{76ee}\u{5f55}\u{91cc}\u{7684}\u{5185}\u{5bb9}\u{5185}\u{5316}\u{6210} DSH \u{63d2}\u{4ef6}\u{5e76}\u{6784}\u{5efa}\u{6ce8}\u{5165}' }],
    },
  }
  assert.match(extractText(nested), /\u{5185}\u{5316}\u{6210}/u)
  assert.equal(bandFor(classifyTask(extractText(nested))), 'react')

  const flat = {
    kind: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: '\u{4fee}\u{590d}\u{8fd9}\u{4e2a}\u{4ed3}\u{5e93}\u{91cc}\u{7684} bug' }],
  }
  assert.equal(extractText(flat), '\u{4fee}\u{590d}\u{8fd9}\u{4e2a}\u{4ed3}\u{5e93}\u{91cc}\u{7684} bug')
  assert.equal(bandFor(classifyTask(extractText(flat))), 'spec')
  assert.equal(sessionMode({ events: [{ type: 'user/message', data: nested }] }), 1)
})

test('upstream router-core 7/15: weak persona is model-specific', () => {
  const pro = personaFor('weak', 'deepseek-v4-pro')
  const flash = personaFor('weak', 'deepseek-v4-flash')
  assert.ok(pro.includes('decide the task type (build or fix)'))
  assert.ok(pro.includes('You are a helpful software engineer assistant.'))
  assert.ok(!pro.includes('review what you have already done'))
  assert.ok(flash.includes('decide the task type (build or fix)'))
  assert.ok(flash.includes('review what you have already done'))
  assert.notEqual(pro, flash)
  assert.equal(personaFor('weak', 'deepseek-v4-flash'), personaFor('weak', 'deepseek-v4-flash'))
  assert.equal(isFlashModel('deepseek-v4-flash'), true)
  assert.equal(isFlashModel('deepseek-v4-pro'), false)
})

test('upstream router-core 8/15: parseMode accepts weak', () => {
  assert.equal(parseMode('weak'), 'weak')
  assert.equal(parseMode('router'), 'weak')
})

test('upstream router-core 9/15: persona quantizes to measured bands', () => {
  assert.equal(personaFor(0), 'You are a helpful software engineer assistant.')
  assert.equal(personaFor(0.1), 'You are a helpful software engineer assistant.')
  assert.ok(personaFor(0.3).includes('Work directly'))
  assert.ok(!personaFor(0.3).includes('test harnesses'))
  assert.ok(personaFor(1).includes('hands-on'))
  assert.ok(personaFor(1).includes('do not build test harnesses'))
})

test('upstream router-core 10/15: core tools vary by band', () => {
  assert.deepEqual(coreFor(0), ['read', 'edit', 'glob', 'grep'])
  assert.deepEqual(coreFor(1), ['read', 'write', 'edit'])
  assert.deepEqual(coreFor(0.3), ['read', 'edit', 'write', 'glob', 'grep'])
  assert.deepEqual(coreFor('weak'), ['str_replace_editor'])
})

test('upstream router-core 11/15: phase transition boundaries are stable', () => {
  assert.equal(bandFor(0.1), 'spec')
  assert.equal(bandFor(0.2), 'mixed')
  assert.equal(bandFor(0.4), 'mixed')
  assert.equal(bandFor(0.5), 'react')
  assert.equal(bandFor(0.99), 'react')
})

test('upstream router-core 12/15: testiness rises toward spec', () => {
  assert.equal(testinessFor(1), 'suppressed')
  assert.equal(testinessFor(0), 'normal')
  assert.equal(testinessFor(0.3), 'light')
})

test('upstream router-core 13/15: parseMode accepts supported tokens', () => {
  assert.equal(parseMode('spec'), 0)
  assert.equal(parseMode('react'), 1)
  assert.equal(parseMode('balanced'), 0.3)
  assert.equal(parseMode('70'), 0.7)
  assert.equal(parseMode('0.3'), 0.3)
  assert.equal(parseMode('auto'), 'auto')
  assert.equal(parseMode('nonsense'), null)
})

test('upstream router-core 14/15: applyPersona preserves plan mode', () => {
  const sections = [
    { name: 'harness-identity', text: 'x', order: -100 },
    { name: 'persona', text: 'old persona', order: 0 },
    { name: 'plan-mode', text: 'You are in plan mode.', order: -50 },
    { name: 'tool-guidance', text: 'y', order: 100 },
  ]
  const out = applyPersona(sections, 'new persona')
  const names = out.map(section => section.name)
  assert.ok(names.includes('harness-identity'))
  assert.ok(names.includes('plan-mode'))
  assert.ok(names.includes('tool-guidance'))
  assert.ok(!names.includes('persona'))
  assert.equal(out.find(section => section.name === 'router-persona').text, 'new persona')
})

test('upstream router-core 15/15: applyPersona accepts empty sections', () => {
  assert.deepEqual(applyPersona([], 'p'), [{ name: 'router-persona', text: 'p', order: 0 }])
})

test('smart bootstrap handles a real weak session event and later promotion', async () => {
  const listeners = new Map()
  const appended = []
  const session = {
    id: 'smart-weak',
    header: { agentPreset: 'standard' },
    events: [{
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Please take a look at this request.' }],
      },
    }],
  }
  assert.equal(sessionMode(session), 'weak')

  const agent = {
    session,
    options: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    inbox: { append(target, message) { appended.push({ target, message }) } },
  }
  const ctx = {
    on(event, listener) { listeners.set(event, listener) },
    effect(register) { return register() },
    tools: { register() { return () => {} } },
    get(service) { return service === 'agent' ? agent : undefined },
    llm: { stream() { throw new Error('not used by this regression') } },
  }
  applyRouter(ctx, {})

  const onEvent = listeners.get('session/event')
  assert.equal(typeof onEvent, 'function')
  assert.doesNotThrow(() => onEvent(session, session.events[0]))
  assert.equal(appended.length, 1)
  assert.equal(appended[0].target, 'next-step')
  assert.equal(appended[0].message.source.plugin, 'router-bootstrap')

  const tools = [
    { name: 'pwsh' },
    { name: 'bash' },
    { name: 'str_replace_editor' },
    { name: 'read' },
    { name: 'write' },
    { name: 'edit' },
    { name: 'glob' },
    { name: 'grep' },
    { name: 'todo_write' },
  ]
  const assemble = listeners.get('system-prompt/assemble')
  assert.equal(typeof assemble, 'function')
  const fresh = await assemble(undefined, { agent }, async () => ({
    sections: [{ name: 'persona', text: 'old' }, { name: 'plan-mode', text: 'keep' }],
    contexts: ['workspace'],
    tools,
  }))
  assert.deepEqual(fresh.tools.map(tool => tool.name), ['pwsh', 'str_replace_editor'])
  assert.ok(fresh.sections.some(section => section.name === 'plan-mode'))

  session.events.push({ type: 'tool/call', data: { name: 'bash' } })
  const promoted = await assemble(undefined, { agent }, async () => ({ sections: [], contexts: [], tools }))
  assert.deepEqual(promoted.tools, tools)
})

test('smart overlay preserves non-standard preset tool catalogs and contexts', async () => {
  for (const agentPreset of ['code', 'minimal', 'cordis', 'custom']) {
    const listeners = new Map()
    const session = {
      id: `smart-${agentPreset}`,
      header: { agentPreset },
      events: [{
        type: 'user/message',
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Build this feature' }] },
      }],
    }
    const agent = { session, options: { model: 'deepseek-v4-pro' }, inbox: { append() {} } }
    const ctx = {
      on(event, listener) { listeners.set(event, listener) },
      effect(register) { return register() },
      tools: { register() { return () => {} } },
      get(service) { return service === 'agent' ? agent : undefined },
    }
    applyRouter(ctx, {})
    const tools = [
      { name: 'bash' },
      { name: 'read' },
      { name: 'edit' },
      { name: 'code' },
      { name: 'str_replace_editor' },
      { name: 'dev_cordis_inspect' },
    ]
    const assembled = await listeners.get('system-prompt/assemble')(
      undefined,
      { agent },
      async () => ({ sections: [{ name: 'persona', text: 'base' }], contexts: ['native-context'], tools }),
    )
    assert.deepEqual(assembled.tools, tools, agentPreset)
    assert.deepEqual(assembled.contexts, ['native-context'], agentPreset)
  }
})

test('smart v0.2 first-request cache classifies text instead of coercing it to mode zero', async () => {
  const listeners = new Map()
  const session = { id: 'smart-first-request', header: { agentPreset: 'standard' }, events: [] }
  const appended = []
  const agent = {
    session,
    options: { model: 'deepseek-v4-pro' },
    inbox: { append(target, message) { appended.push({ target, message }) } },
  }
  const ctx = {
    on(event, listener) { listeners.set(event, listener) },
    effect(register) { return register() },
    tools: { register() { return () => {} } },
    get(service) { return service === 'agent' ? agent : undefined },
  }
  applyRouter(ctx, {})

  const event = {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Build a new web application' }] },
  }
  listeners.get('session/event')(session, event)
  const tools = ['bash', 'str_replace_editor', 'read', 'write', 'edit', 'glob', 'grep'].map(name => ({ name }))
  const assembled = await listeners.get('system-prompt/assemble')(
    undefined,
    { agent },
    async () => ({ sections: [{ name: 'persona', text: 'base' }], contexts: ['native'], tools }),
  )
  assert.deepEqual(assembled.tools.map(tool => tool.name), ['bash', 'read', 'write', 'edit'])
  assert.equal(appended.length, 0)
})
