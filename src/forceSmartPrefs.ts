/** Durable ForceSmart enhancement preference and per-session fork state. */
import {
  type EnhancementSessionEvent,
  type EnhancementSessionHeader,
  enhancementModeOf,
  readEnhancementDefault,
  readEnhancementSession,
  writeEnhancementDefault,
  writeEnhancementSession,
} from './enhancementPrefs.js'

/** Read-only compatibility marker for request headers written before 0.6.2. */
export const FORCE_SMART_PROMPT_MARKER = '<!-- dsh-tui-force-smart:v1 -->'
const DEFINITION = { file: 'force-smart.json', legacyPromptMarker: FORCE_SMART_PROMPT_MARKER } as const

export const readForceSmartDefault = (dir?: string): boolean | undefined =>
  readEnhancementDefault(DEFINITION, dir)
export const writeForceSmartDefault = (enabled: boolean, dir?: string): boolean =>
  writeEnhancementDefault(DEFINITION, enabled, dir)
export const readForceSmartSession = (sessionId: string, dir?: string): boolean | undefined =>
  readEnhancementSession(DEFINITION, sessionId, dir)
export const writeForceSmartSession = (sessionId: string, enabled: boolean, dir?: string): boolean =>
  writeEnhancementSession(DEFINITION, sessionId, enabled, dir)

export function forceSmartModeOf(
  session: { header: EnhancementSessionHeader; events: readonly EnhancementSessionEvent[] },
  stored: boolean | undefined = readForceSmartSession(String(session.header.id)),
): boolean {
  return enhancementModeOf(DEFINITION, session, stored)
}

export async function resolvePersistedForceSmart(
  ctx: { get(name: string): unknown },
  sessionId: string,
): Promise<boolean> {
  const stored = readForceSmartSession(String(sessionId))
  const persistence = ctx.get('sessionPersistence') as
    | {
        load(id: string): Promise<{
          meta: EnhancementSessionHeader
          events: readonly EnhancementSessionEvent[]
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
