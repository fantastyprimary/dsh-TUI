/** Durable Smart enhancement preference and per-session fork state. */
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  enhancementModeOf,
  readEnhancementDefault,
  readEnhancementSession,
  resolvePersistedEnhancement,
  writeEnhancementDefault,
  writeEnhancementSession,
} from './enhancementPrefs.js'

export const SMART_PROMPT_MARKER = '<!-- dsh-tui-smart:v1 -->'
const DEFINITION = { file: 'smart.json', marker: SMART_PROMPT_MARKER } as const

export const readSmartDefault = (dir?: string): boolean | undefined =>
  readEnhancementDefault(DEFINITION, dir)
export const writeSmartDefault = (enabled: boolean, dir?: string): boolean =>
  writeEnhancementDefault(DEFINITION, enabled, dir)
export const readSmartSession = (sessionId: string, dir?: string): boolean | undefined =>
  readEnhancementSession(DEFINITION, sessionId, dir)
export const writeSmartSession = (sessionId: string, enabled: boolean, dir?: string): boolean =>
  writeEnhancementSession(DEFINITION, sessionId, enabled, dir)

export function smartModeOf(
  session: { header: Pick<SessionHeader, 'id' | 'seedLength'>; events: readonly SessionEvent[] },
  stored?: boolean,
): boolean {
  return enhancementModeOf(DEFINITION, session, stored)
}

export async function resolvePersistedSmart(
  ctx: { get(name: string): unknown },
  sessionId: SessionId,
): Promise<boolean> {
  return await resolvePersistedEnhancement(DEFINITION, ctx, sessionId)
}
