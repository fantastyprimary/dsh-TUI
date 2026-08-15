/** Shared durable preference/sidecar implementation for orthogonal enhancements. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { DATA_DIR } from './utils/paths.js'

const MAX_SESSION_RECORDS = 512

interface EnhancementSessionRecord {
  readonly enabled: boolean
  readonly updatedAt: number
}

interface EnhancementPrefs {
  readonly enabled?: boolean
  readonly sessions: Record<string, EnhancementSessionRecord>
}

export interface EnhancementPrefsDefinition {
  readonly file: string
  readonly marker: string
}

export interface EnhancementSelection {
  readonly smart: boolean
  readonly forceSmart: boolean
}

/** Resolve the two public toggles as one mutually exclusive startup choice. */
export function resolveEnhancementSelection(
  configuredSmart: boolean | undefined,
  configuredForceSmart: boolean | undefined,
  defaultSmart: boolean | undefined,
  defaultForceSmart: boolean | undefined,
): EnhancementSelection {
  if (configuredForceSmart === true) return { smart: false, forceSmart: true }
  if (configuredSmart === true) return { smart: true, forceSmart: false }

  const forceSmart = configuredForceSmart ?? defaultForceSmart ?? false
  if (forceSmart) return { smart: false, forceSmart: true }
  return {
    smart: configuredSmart ?? defaultSmart ?? false,
    forceSmart: false,
  }
}

function parse(text: string): EnhancementPrefs {
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { sessions: {} }
    const source = value as Record<string, unknown>
    const sessions: Record<string, EnhancementSessionRecord> = {}
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

function read(definition: EnhancementPrefsDefinition, dir: string): EnhancementPrefs {
  try {
    return parse(readFileSync(join(dir, definition.file), 'utf8'))
  } catch {
    return { sessions: {} }
  }
}

function write(definition: EnhancementPrefsDefinition, value: EnhancementPrefs, dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, definition.file)
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
    return true
  } catch {
    return false
  }
}

export function readEnhancementDefault(
  definition: EnhancementPrefsDefinition,
  dir: string = DATA_DIR,
): boolean | undefined {
  return read(definition, dir).enabled
}

export function writeEnhancementDefault(
  definition: EnhancementPrefsDefinition,
  enabled: boolean,
  dir: string = DATA_DIR,
): boolean {
  const current = read(definition, dir)
  return write(definition, { ...current, enabled }, dir)
}

export function readEnhancementSession(
  definition: EnhancementPrefsDefinition,
  sessionId: string,
  dir: string = DATA_DIR,
): boolean | undefined {
  return read(definition, dir).sessions[sessionId]?.enabled
}

export function writeEnhancementSession(
  definition: EnhancementPrefsDefinition,
  sessionId: string,
  enabled: boolean,
  dir: string = DATA_DIR,
): boolean {
  const current = read(definition, dir)
  const sessions = {
    ...current.sessions,
    [sessionId]: { enabled, updatedAt: Date.now() },
  }
  const retained = Object.fromEntries(
    Object.entries(sessions)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_SESSION_RECORDS),
  )
  return write(definition, { ...current, sessions: retained }, dir)
}

function headerEnabled(definition: EnhancementPrefsDefinition, event: SessionEvent | undefined): boolean | undefined {
  if (event?.type !== 'request/header') return undefined
  return event.data.header.system?.includes(definition.marker) === true
}

export function enhancementModeOf(
  definition: EnhancementPrefsDefinition,
  session: { header: Pick<SessionHeader, 'id' | 'seedLength'>; events: readonly SessionEvent[] },
  stored: boolean | undefined = readEnhancementSession(definition, String(session.header.id)),
): boolean {
  const localStart = session.header.seedLength ?? 0
  const localHeader = session.events.findLast(event => event.seq >= localStart && event.type === 'request/header')
  const local = headerEnabled(definition, localHeader)
  if (local !== undefined) return local
  if (stored !== undefined) return stored
  const inherited = headerEnabled(definition, session.events.findLast(event => event.type === 'request/header'))
  return inherited ?? false
}

export async function resolvePersistedEnhancement(
  definition: EnhancementPrefsDefinition,
  ctx: { get(name: string): unknown },
  sessionId: SessionId,
): Promise<boolean> {
  const persistence = ctx.get('sessionPersistence') as
    | {
        load(id: SessionId): Promise<{
          meta: SessionHeader
          events: readonly SessionEvent[]
        }>
      }
    | undefined
  const stored = readEnhancementSession(definition, String(sessionId))
  if (persistence === undefined) return stored ?? false
  try {
    const persisted = await persistence.load(sessionId)
    return enhancementModeOf(definition, { header: persisted.meta, events: persisted.events }, stored)
  } catch {
    return stored ?? false
  }
}
