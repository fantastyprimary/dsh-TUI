/** Shared durable preference/sidecar implementation for orthogonal enhancements. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './utils/paths.js';
const MAX_SESSION_RECORDS = 512;
/** Resolve the two public toggles as one mutually exclusive startup choice. */
export function resolveEnhancementSelection(configuredSmart, configuredForceSmart, defaultSmart, defaultForceSmart) {
    if (configuredForceSmart === true)
        return { smart: false, forceSmart: true };
    if (configuredSmart === true)
        return { smart: true, forceSmart: false };
    const forceSmart = configuredForceSmart ?? defaultForceSmart ?? false;
    if (forceSmart)
        return { smart: false, forceSmart: true };
    return {
        smart: configuredSmart ?? defaultSmart ?? false,
        forceSmart: false,
    };
}
function parse(text) {
    try {
        const value = JSON.parse(text);
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            return { sessions: {} };
        const source = value;
        const sessions = {};
        if (source.sessions !== null && typeof source.sessions === 'object' && !Array.isArray(source.sessions)) {
            for (const [id, record] of Object.entries(source.sessions)) {
                if (record === null || typeof record !== 'object' || Array.isArray(record))
                    continue;
                const candidate = record;
                if (typeof candidate.enabled !== 'boolean' || typeof candidate.updatedAt !== 'number')
                    continue;
                sessions[id] = { enabled: candidate.enabled, updatedAt: candidate.updatedAt };
            }
        }
        return {
            ...(typeof source.enabled === 'boolean' ? { enabled: source.enabled } : {}),
            sessions,
        };
    }
    catch {
        return { sessions: {} };
    }
}
function read(definition, dir) {
    try {
        return parse(readFileSync(join(dir, definition.file), 'utf8'));
    }
    catch {
        return { sessions: {} };
    }
}
function write(definition, value, dir) {
    try {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, definition.file);
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        renameSync(temporary, file);
        return true;
    }
    catch {
        return false;
    }
}
export function readEnhancementDefault(definition, dir = DATA_DIR) {
    return read(definition, dir).enabled;
}
export function writeEnhancementDefault(definition, enabled, dir = DATA_DIR) {
    const current = read(definition, dir);
    return write(definition, { ...current, enabled }, dir);
}
export function readEnhancementSession(definition, sessionId, dir = DATA_DIR) {
    return read(definition, dir).sessions[sessionId]?.enabled;
}
export function writeEnhancementSession(definition, sessionId, enabled, dir = DATA_DIR) {
    const current = read(definition, dir);
    const sessions = {
        ...current.sessions,
        [sessionId]: { enabled, updatedAt: Date.now() },
    };
    const retained = Object.fromEntries(Object.entries(sessions)
        .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
        .slice(0, MAX_SESSION_RECORDS));
    return write(definition, { ...current, sessions: retained }, dir);
}
function headerEnabled(definition, event) {
    if (event?.type !== 'request/header')
        return undefined;
    return event.data.header.system?.includes(definition.marker) === true;
}
export function enhancementModeOf(definition, session, stored = readEnhancementSession(definition, String(session.header.id))) {
    const localStart = session.header.seedLength ?? 0;
    const localHeader = session.events.findLast(event => event.seq >= localStart && event.type === 'request/header');
    const local = headerEnabled(definition, localHeader);
    if (local !== undefined)
        return local;
    if (stored !== undefined)
        return stored;
    const inherited = headerEnabled(definition, session.events.findLast(event => event.type === 'request/header'));
    return inherited ?? false;
}
export async function resolvePersistedEnhancement(definition, ctx, sessionId) {
    const persistence = ctx.get('sessionPersistence');
    const stored = readEnhancementSession(definition, String(sessionId));
    if (persistence === undefined)
        return stored ?? false;
    try {
        const persisted = await persistence.load(sessionId);
        return enhancementModeOf(definition, { header: persisted.meta, events: persisted.events }, stored);
    }
    catch {
        return stored ?? false;
    }
}
