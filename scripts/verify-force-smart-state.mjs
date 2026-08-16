/**
 * ForceSmart preference, fork-state, and mutual-exclusion regression coverage.
 *
 * Run with plain node against the compiled lib (after `pnpm build`):
 *   node scripts/verify-force-smart-state.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const testHome = mkdtempSync(join(tmpdir(), 'dsh-tui-force-smart-state-'))
process.env.HOME = testHome
process.env.USERPROFILE = testHome

function cleanup() {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserProfile
  rmSync(testHome, { recursive: true, force: true })
}

let forceSmartPrefs
let smartPrefs
let enhancementPrefs
try {
  forceSmartPrefs = await import('../lib/types/forceSmartPrefs.js')
  smartPrefs = await import('../lib/types/smartPrefs.js')
  enhancementPrefs = await import('../lib/types/enhancementPrefs.js')
} catch (error) {
  cleanup()
  throw error
}

const {
  FORCE_SMART_PROMPT_MARKER,
  forceSmartModeOf,
  readForceSmartDefault,
  readForceSmartSession,
  resolvePersistedForceSmart,
  writeForceSmartDefault,
  writeForceSmartSession,
} = forceSmartPrefs
const { SMART_PROMPT_MARKER, smartModeOf } = smartPrefs
const { resolveEnhancementSelection } = enhancementPrefs

const prefsDir = join(testHome, '.dsh-tui')
const prefsFile = join(prefsDir, 'force-smart.json')

function requestHeader(seq, { forceSmart = false, smart = false } = {}) {
  const system = ['base system']
  if (smart) system.push(SMART_PROMPT_MARKER)
  if (forceSmart) system.push(FORCE_SMART_PROMPT_MARKER)
  return {
    type: 'request/header',
    seq,
    time: seq,
    data: { header: { system: system.join('\n') } },
  }
}

function session(id, seedLength, events) {
  return { header: { id, seedLength }, events }
}

test('ForceSmart default and per-session state persist in force-smart.json', () => {
  assert.equal(readForceSmartDefault(), undefined)
  assert.equal(readForceSmartSession('alpha'), undefined)

  assert.equal(writeForceSmartDefault(true), true)
  assert.equal(writeForceSmartSession('alpha', false), true)
  assert.equal(readForceSmartDefault(), true)
  assert.equal(readForceSmartSession('alpha'), false)

  const stored = JSON.parse(readFileSync(prefsFile, 'utf8'))
  assert.equal(stored.enabled, true)
  assert.equal(stored.sessions.alpha.enabled, false)
  assert.equal(typeof stored.sessions.alpha.updatedAt, 'number')

  assert.equal(writeForceSmartDefault(false), true)
  assert.equal(readForceSmartDefault(), false)
  assert.equal(readForceSmartSession('alpha'), false)
})

test('a fork child uses its ForceSmart sidecar even when legacy headers disagree', () => {
  const inherited = requestHeader(3, { forceSmart: true })
  const child = session('child-before-request', 4, [inherited])

  assert.equal(forceSmartModeOf(child, false), false)
  assert.equal(forceSmartModeOf(child, true), true)
})

test('the ForceSmart sidecar overrides child-local and inherited legacy headers', async () => {
  const localOff = session('child-local-off', 4, [
    requestHeader(3, { forceSmart: true }),
    requestHeader(4),
  ])
  assert.equal(forceSmartModeOf(localOff, true), true)

  const localOn = session('child-local-on', 4, [
    requestHeader(3),
    requestHeader(4, { forceSmart: true }),
  ])
  assert.equal(forceSmartModeOf(localOn, false), false)

  assert.equal(writeForceSmartSession('persisted-child', true), true)
  const persisted = session('persisted-child', 4, [
    requestHeader(3, { forceSmart: true }),
    requestHeader(4),
  ])
  const ctx = {
    get(name) {
      if (name !== 'sessionPersistence') return undefined
      return {
        async load(id) {
          assert.equal(String(id), 'persisted-child')
          return { meta: persisted.header, events: persisted.events }
        },
      }
    },
  }
  assert.equal(await resolvePersistedForceSmart(ctx, 'persisted-child'), true)
})

test('an inherited ForceSmart marker is recognized when no sidecar exists', () => {
  const inherited = session('inherited-only', 2, [
    requestHeader(1, { forceSmart: true }),
  ])
  assert.equal(forceSmartModeOf(inherited), true)

  const smartOnly = session('inherited-smart-only', 2, [
    requestHeader(1, { smart: true }),
  ])
  assert.equal(forceSmartModeOf(smartOnly), false)
})

test('a ForceSmart sidecar identifies marker-free Minimal bootstrap headers', async () => {
  const markerFree = session('marker-free', 0, [
    {
      type: 'request/header',
      seq: 0,
      data: {
        header: {
          system: 'You are a helpful software engineer assistant.',
          config: { maxTokens: 1024 },
          tools: [{ name: 'bash' }, { name: 'str_replace_editor' }],
        },
      },
    },
  ])
  assert.equal(forceSmartModeOf(markerFree, true), true)
  assert.equal(forceSmartModeOf(markerFree, false), false)

  assert.equal(writeForceSmartSession('marker-free', true), true)
  const ctx = {
    get(name) {
      if (name !== 'sessionPersistence') return undefined
      return { async load() { return { meta: markerFree.header, events: markerFree.events } } }
    },
  }
  assert.equal(await resolvePersistedForceSmart(ctx, 'marker-free'), true)
})

test('ForceSmart wins mutual exclusion when a request contains both markers', () => {
  const dualMarker = session('dual-marker', 0, [
    requestHeader(0, { smart: true, forceSmart: true }),
  ])
  const rawSmart = smartModeOf(dualMarker)
  const rawForceSmart = forceSmartModeOf(dualMarker)

  assert.equal(rawSmart, true)
  assert.equal(rawForceSmart, true)
  assert.deepEqual(
    resolveEnhancementSelection(rawSmart, rawForceSmart, undefined, undefined),
    { smart: false, forceSmart: true },
  )
})

test('explicit startup configuration wins persisted defaults before mutual exclusion', () => {
  assert.deepEqual(
    resolveEnhancementSelection(true, undefined, false, true),
    { smart: true, forceSmart: false },
  )
  assert.deepEqual(
    resolveEnhancementSelection(undefined, true, true, false),
    { smart: false, forceSmart: true },
  )
  assert.deepEqual(
    resolveEnhancementSelection(true, true, false, false),
    { smart: false, forceSmart: true },
  )
})

test('corrupt ForceSmart preference data fails closed', () => {
  writeFileSync(prefsFile, '{ definitely not json', 'utf8')
  assert.equal(readForceSmartDefault(), undefined)
  assert.equal(readForceSmartSession('alpha'), undefined)
  assert.equal(forceSmartModeOf(session('corrupt-empty', 0, [])), false)
})

test.after(() => {
  cleanup()
})
