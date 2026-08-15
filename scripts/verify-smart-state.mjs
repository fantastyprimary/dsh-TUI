/**
 * Smart preference and fork-state resolution regression.
 *
 * Run with plain node against the compiled lib (after `pnpm build`):
 *   node scripts/verify-smart-state.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const testHome = mkdtempSync(join(tmpdir(), 'dsh-tui-smart-state-'))
process.env.HOME = testHome
process.env.USERPROFILE = testHome

function cleanup() {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserProfile
  rmSync(testHome, { recursive: true, force: true })
}

let smartPrefs
try {
  smartPrefs = await import('../lib/types/smartPrefs.js')
} catch (error) {
  cleanup()
  throw error
}

const {
  SMART_PROMPT_MARKER,
  readSmartDefault,
  readSmartSession,
  resolvePersistedSmart,
  smartModeOf,
  writeSmartDefault,
  writeSmartSession,
} = smartPrefs

const prefsDir = join(testHome, '.dsh-cc')
const prefsFile = join(prefsDir, 'smart.json')

function requestHeader(seq, smart) {
  return {
    type: 'request/header',
    seq,
    time: seq,
    data: {
      header: {
        system: smart ? `base\n${SMART_PROMPT_MARKER}\nrouter` : 'base only',
        tools: smart ? [{ name: 'dev_smart_status' }] : [{ name: 'read' }],
      },
    },
  }
}

function session(id, seedLength, events) {
  return { header: { id, seedLength }, events }
}

test('Smart default and per-session state persist independently', () => {
  assert.equal(readSmartDefault(), undefined)
  assert.equal(readSmartSession('alpha'), undefined)

  assert.equal(writeSmartDefault(true), true)
  assert.equal(writeSmartSession('alpha', false), true)
  assert.equal(readSmartDefault(), true)
  assert.equal(readSmartSession('alpha'), false)

  assert.equal(writeSmartDefault(false), true)
  assert.equal(readSmartDefault(), false)
  assert.equal(readSmartSession('alpha'), false)
})

test('a fork child uses its sidecar until it emits a local request header', () => {
  const inherited = requestHeader(3, true)
  const child = session('child-before-request', 4, [inherited])

  assert.equal(smartModeOf(child, false), false)
  assert.equal(smartModeOf(child, true), true)
  assert.equal(smartModeOf(child, undefined), true)
})

test('the first child-local request header supersedes sidecar and inherited state', () => {
  const inheritedOn = requestHeader(3, true)
  assert.equal(
    smartModeOf(session('child-off', 4, [inheritedOn, requestHeader(4, false)]), true),
    false,
  )

  const inheritedOff = requestHeader(3, false)
  assert.equal(
    smartModeOf(session('child-on', 4, [inheritedOff, requestHeader(4, true)]), false),
    true,
  )
})

test('ordinary and legacy sessions derive Smart from their latest request header', () => {
  assert.equal(smartModeOf(session('ordinary-on', undefined, [requestHeader(0, true)]), undefined), true)
  assert.equal(
    smartModeOf(session('ordinary-off', undefined, [requestHeader(0, true), requestHeader(1, false)]), undefined),
    false,
  )
  assert.equal(smartModeOf(session('legacy-empty', undefined, []), undefined), false)
})

test('persisted resolution applies the same child-local precedence', async () => {
  writeSmartSession('persisted-child', true)
  const persisted = session('persisted-child', 2, [requestHeader(1, true), requestHeader(2, false)])
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
  assert.equal(await resolvePersistedSmart(ctx, 'persisted-child'), false)
})

test('corrupt preference data fails closed', () => {
  writeFileSync(prefsFile, '{ definitely not json', 'utf8')
  assert.equal(readSmartDefault(), undefined)
  assert.equal(readSmartSession('alpha'), undefined)
})

test.after(() => {
  cleanup()
})
