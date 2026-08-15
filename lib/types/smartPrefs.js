/** Durable Smart enhancement preference and per-session fork state. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './utils/paths.js';
const PREFS_DIR = DATA_DIR;
const MAX_SESSION_RECORDS = 512;
export const SMART_PROMPT_MARKER = '<!-- dsh-tui-smart:v1 -->';
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
function read(dir) {
    try {
        return parse(readFileSync(join(dir, 'smart.json'), 'utf8'));
    }
    catch {
        return { sessions: {} };
    }
}
function write(value, dir) {
    try {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, 'smart.json');
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        renameSync(temporary, file);
        return true;
    }
    catch {
        return false;
    }
}
export function readSmartDefault(dir = PREFS_DIR) {
    return read(dir).enabled;
}
export function writeSmartDefault(enabled, dir = PREFS_DIR) {
    const current = read(dir);
    return write({ ...current, enabled }, dir);
}
export function readSmartSession(sessionId, dir = PREFS_DIR) {
    return read(dir).sessions[sessionId]?.enabled;
}
export function writeSmartSession(sessionId, enabled, dir = PREFS_DIR) {
    const current = read(dir);
    const sessions = {
        ...current.sessions,
        [sessionId]: { enabled, updatedAt: Date.now() },
    };
    const retained = Object.fromEntries(Object.entries(sessions)
        .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
        .slice(0, MAX_SESSION_RECORDS));
    return write({ ...current, sessions: retained }, dir);
}
function headerSmart(event) {
    if (event?.type !== 'request/header')
        return undefined;
    return event.data.header.system?.includes(SMART_PROMPT_MARKER) === true;
}
/**
 * Resolve Smart without interpreting inherited fork headers as child state.
 * A child-local request header is authoritative; before the child's first
 * request, the sidecar record bridges the creation-header extension gap.
 */
export function smartModeOf(session, stored = readSmartSession(String(session.header.id))) {
    const localStart = session.header.seedLength ?? 0;
    const localHeader = session.events.findLast(event => event.seq >= localStart && event.type === 'request/header');
    const local = headerSmart(localHeader);
    if (local !== undefined)
        return local;
    if (stored !== undefined)
        return stored;
    const inherited = headerSmart(session.events.findLast(event => event.type === 'request/header'));
    return inherited ?? false;
}
export async function resolvePersistedSmart(ctx, sessionId) {
    const persistence = ctx.get('sessionPersistence');
    const stored = readSmartSession(String(sessionId));
    if (persistence === undefined)
        return stored ?? false;
    try {
        const persisted = await persistence.load(sessionId);
        return smartModeOf({ header: persisted.meta, events: persisted.events }, stored);
    }
    catch {
        return stored ?? false;
    }
}
