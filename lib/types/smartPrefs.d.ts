/** Durable Smart enhancement preference and per-session fork state. */
import { type EnhancementSessionEvent, type EnhancementSessionHeader } from './enhancementPrefs.js';
export declare const SMART_PROMPT_MARKER = "<!-- dsh-tui-smart:v1 -->";
export declare const readSmartDefault: (dir?: string) => boolean | undefined;
export declare const writeSmartDefault: (enabled: boolean, dir?: string) => boolean;
export declare const readSmartSession: (sessionId: string, dir?: string) => boolean | undefined;
export declare const writeSmartSession: (sessionId: string, enabled: boolean, dir?: string) => boolean;
export declare function smartModeOf(session: {
    header: EnhancementSessionHeader;
    events: readonly EnhancementSessionEvent[];
}, stored?: boolean): boolean;
export declare function resolvePersistedSmart(ctx: {
    get(name: string): unknown;
}, sessionId: string): Promise<boolean>;
//# sourceMappingURL=smartPrefs.d.ts.map