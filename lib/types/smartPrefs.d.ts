import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
export declare const SMART_PROMPT_MARKER = "<!-- dsh-tui-smart:v1 -->";
export declare function readSmartDefault(dir?: string): boolean | undefined;
export declare function writeSmartDefault(enabled: boolean, dir?: string): boolean;
export declare function readSmartSession(sessionId: string, dir?: string): boolean | undefined;
export declare function writeSmartSession(sessionId: string, enabled: boolean, dir?: string): boolean;
/**
 * Resolve Smart without interpreting inherited fork headers as child state.
 * A child-local request header is authoritative; before the child's first
 * request, the sidecar record bridges the creation-header extension gap.
 */
export declare function smartModeOf(session: {
    header: Pick<SessionHeader, 'id' | 'seedLength'>;
    events: readonly SessionEvent[];
}, stored?: boolean | undefined): boolean;
export declare function resolvePersistedSmart(ctx: {
    get(name: string): unknown;
}, sessionId: SessionId): Promise<boolean>;
//# sourceMappingURL=smartPrefs.d.ts.map