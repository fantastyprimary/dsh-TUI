import { enhancementModeOf, readEnhancementDefault, readEnhancementSession, resolvePersistedEnhancement, writeEnhancementDefault, writeEnhancementSession, } from './enhancementPrefs.js';
export const SMART_PROMPT_MARKER = '<!-- dsh-tui-smart:v1 -->';
const DEFINITION = { file: 'smart.json', marker: SMART_PROMPT_MARKER };
export const readSmartDefault = (dir) => readEnhancementDefault(DEFINITION, dir);
export const writeSmartDefault = (enabled, dir) => writeEnhancementDefault(DEFINITION, enabled, dir);
export const readSmartSession = (sessionId, dir) => readEnhancementSession(DEFINITION, sessionId, dir);
export const writeSmartSession = (sessionId, enabled, dir) => writeEnhancementSession(DEFINITION, sessionId, enabled, dir);
export function smartModeOf(session, stored) {
    return enhancementModeOf(DEFINITION, session, stored);
}
export async function resolvePersistedSmart(ctx, sessionId) {
    return await resolvePersistedEnhancement(DEFINITION, ctx, sessionId);
}
