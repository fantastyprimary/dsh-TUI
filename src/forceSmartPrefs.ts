/** Durable ForceSmart enhancement preference and per-session fork state. */
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  enhancementModeOf,
  readEnhancementDefault,
  readEnhancementSession,
  writeEnhancementDefault,
  writeEnhancementSession,
} from './enhancementPrefs.js'

export const FORCE_SMART_PROMPT_MARKER = '<!-- dsh-tui-force-smart:v1 -->'
const DEFINITION = { file: 'force-smart.json', marker: FORCE_SMART_PROMPT_MARKER } as const

export const readForceSmartDefault = (dir?: string): boolean | undefined =>
  readEnhancementDefault(DEFINITION, dir)
export const writeForceSmartDefault = (enabled: boolean, dir?: string): boolean =>
  writeEnhancementDefault(DEFINITION, enabled, dir)
export const readForceSmartSession = (sessionId: string, dir?: string): boolean | undefined =>
  readEnhancementSession(DEFINITION, sessionId, dir)
export const writeForceSmartSession = (sessionId: string, enabled: boolean, dir?: string): boolean =>
  writeEnhancementSession(DEFINITION, sessionId, enabled, dir)

export function forceSmartModeOf(
  session: { header: Pick<SessionHeader, 'id' | 'seedLength'>; events: readonly SessionEvent[] },
  stored: boolean | undefined = readForceSmartSession(String(session.header.id)),
): boolean {
  const localStart = session.header.seedLength ?? 0
  const localHeader = session.events.findLast(event =>
    event.seq >= localStart && event.type === 'request/header')
  if (localHeader?.type === 'request/header') {
    const header = localHeader.data.header
    if (header.system?.includes(FORCE_SMART_PROMPT_MARKER)) return true
    const tools = header.tools?.map(tool => tool.name) ?? []
    const bootstrap = stored === true
      && header.system === 'You are a helpful software engineer assistant.'
      && header.config.maxTokens === 1024
      && tools.length === 2
      && tools.includes('str_replace_editor')
      && tools.includes('bash')
    return bootstrap
  }
  return enhancementModeOf(DEFINITION, session, stored)
}

export async function resolvePersistedForceSmart(
  ctx: { get(name: string): unknown },
  sessionId: SessionId,
): Promise<boolean> {
  const stored = readForceSmartSession(String(sessionId))
  const persistence = ctx.get('sessionPersistence') as
    | {
        load(id: SessionId): Promise<{
          meta: SessionHeader
          events: readonly SessionEvent[]
        }>
      }
    | undefined
  if (persistence === undefined) return stored ?? false
  try {
    const persisted = await persistence.load(sessionId)
    return forceSmartModeOf({ header: persisted.meta, events: persisted.events }, stored)
  } catch {
    return stored ?? false
  }
}
