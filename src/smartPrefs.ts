/** Durable Smart enhancement preference and per-session fork state. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

const PREFS_DIR = join(homedir(), '.dsh-cc')
const MAX_SESSION_RECORDS = 512
export const SMART_PROMPT_MARKER = '<!-- dsh-tui-smart:v1 -->'

interface SmartSessionRecord {
  readonly enabled: boolean
  readonly updatedAt: number
}

interface SmartPrefs {
  readonly enabled?: boolean
  readonly sessions: Record<string, SmartSessionRecord>
}

function parse(text: string): SmartPrefs {
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { sessions: {} }
    const source = value as Record<string, unknown>
    const sessions: Record<string, SmartSessionRecord> = {}
    if (source.sessions !== null && typeof source.sessions === 'object' && !Array.isArray(source.sessions)) {
      for (const [id, record] of Object.entries(source.sessions as Record<string, unknown>)) {
        if (record === null || typeof record !== 'object' || Array.isArray(record)) continue
        const candidate = record as Record<string, unknown>
        if (typeof candidate.enabled !== 'boolean' || typeof candidate.updatedAt !== 'number') continue
        sessions[id] = { enabled: candidate.enabled, updatedAt: candidate.updatedAt }
      }
    }
    return {
      ...(typeof source.enabled === 'boolean' ? { enabled: source.enabled } : {}),
      sessions,
    }
  } catch {
    return { sessions: {} }
  }
}

function read(dir: string): SmartPrefs {
  try {
    return parse(readFileSync(join(dir, 'smart.json'), 'utf8'))
  } catch {
    return { sessions: {} }
  }
}

function write(value: SmartPrefs, dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'smart.json')
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
    return true
  } catch {
    return false
  }
}

export function readSmartDefault(dir: string = PREFS_DIR): boolean | undefined {
  return read(dir).enabled
}

export function writeSmartDefault(enabled: boolean, dir: string = PREFS_DIR): boolean {
  const current = read(dir)
  return write({ ...current, enabled }, dir)
}

export function readSmartSession(sessionId: string, dir: string = PREFS_DIR): boolean | undefined {
  return read(dir).sessions[sessionId]?.enabled
}

export function writeSmartSession(sessionId: string, enabled: boolean, dir: string = PREFS_DIR): boolean {
  const current = read(dir)
  const sessions = {
    ...current.sessions,
    [sessionId]: { enabled, updatedAt: Date.now() },
  }
  const retained = Object.fromEntries(
    Object.entries(sessions)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_SESSION_RECORDS),
  )
  return write({ ...current, sessions: retained }, dir)
}

function headerSmart(event: SessionEvent | undefined): boolean | undefined {
  if (event?.type !== 'request/header') return undefined
  return event.data.header.system?.includes(SMART_PROMPT_MARKER) === true
}

/**
 * Resolve Smart without interpreting inherited fork headers as child state.
 * A child-local request header is authoritative; before the child's first
 * request, the sidecar record bridges the creation-header extension gap.
 */
export function smartModeOf(
  session: { header: Pick<SessionHeader, 'id' | 'seedLength'>; events: readonly SessionEvent[] },
  stored: boolean | undefined = readSmartSession(String(session.header.id)),
): boolean {
  const localStart = session.header.seedLength ?? 0
  const localHeader = session.events.findLast(event => event.seq >= localStart && event.type === 'request/header')
  const local = headerSmart(localHeader)
  if (local !== undefined) return local
  if (stored !== undefined) return stored
  const inherited = headerSmart(session.events.findLast(event => event.type === 'request/header'))
  return inherited ?? false
}

export async function resolvePersistedSmart(ctx: { get(name: string): unknown }, sessionId: SessionId): Promise<boolean> {
  const persistence = ctx.get('sessionPersistence') as
    | {
        load(id: SessionId): Promise<{
          meta: SessionHeader
          events: readonly SessionEvent[]
        }>
      }
    | undefined
  const stored = readSmartSession(String(sessionId))
  if (persistence === undefined) return stored ?? false
  try {
    const persisted = await persistence.load(sessionId)
    return smartModeOf({ header: persisted.meta, events: persisted.events }, stored)
  } catch {
    return stored ?? false
  }
}
