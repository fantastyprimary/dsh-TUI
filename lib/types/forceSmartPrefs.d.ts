/** Durable ForceSmart enhancement preference and per-session fork state. */
import { type EnhancementSessionEvent, type EnhancementSessionHeader } from './enhancementPrefs.js';
export declare const FORCE_SMART_PROMPT_MARKER = "<!-- dsh-tui-force-smart:v1 -->";
export declare const readForceSmartDefault: (dir?: string) => boolean | undefined;
export declare const writeForceSmartDefault: (enabled: boolean, dir?: string) => boolean;
export declare const readForceSmartSession: (sessionId: string, dir?: string) => boolean | undefined;
export declare const writeForceSmartSession: (sessionId: string, enabled: boolean, dir?: string) => boolean;
export declare function forceSmartModeOf(session: {
    header: EnhancementSessionHeader;
    events: readonly EnhancementSessionEvent[];
}, stored?: boolean | undefined): boolean;
export declare function resolvePersistedForceSmart(ctx: {
    get(name: string): unknown;
}, sessionId: string): Promise<boolean>;
//# sourceMappingURL=forceSmartPrefs.d.ts.map