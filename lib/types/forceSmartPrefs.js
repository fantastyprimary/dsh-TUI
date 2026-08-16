/** Durable ForceSmart enhancement preference and per-session fork state. */
import { enhancementModeOf, readEnhancementDefault, readEnhancementSession, writeEnhancementDefault, writeEnhancementSession, } from './enhancementPrefs.js';
const DEFINITION = { file: 'force-smart.json' };
export const readForceSmartDefault = (dir) => readEnhancementDefault(DEFINITION, dir);
export const writeForceSmartDefault = (enabled, dir) => writeEnhancementDefault(DEFINITION, enabled, dir);
export const readForceSmartSession = (sessionId, dir) => readEnhancementSession(DEFINITION, sessionId, dir);
export const writeForceSmartSession = (sessionId, enabled, dir) => writeEnhancementSession(DEFINITION, sessionId, enabled, dir);
export function forceSmartModeOf(session, stored = readForceSmartSession(String(session.header.id))) {
    return enhancementModeOf(DEFINITION, session, stored);
}
export async function resolvePersistedForceSmart(ctx, sessionId) {
    const stored = readForceSmartSession(String(sessionId));
    const persistence = ctx.get('sessionPersistence');
    if (persistence === undefined)
        return stored ?? false;
    try {
        const persisted = await persistence.load(sessionId);
        return forceSmartModeOf({ header: persisted.meta, events: persisted.events }, stored);
    }
    catch {
        return stored ?? false;
    }
}
