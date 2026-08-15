import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
export interface EnhancementPrefsDefinition {
    readonly file: string;
    readonly marker: string;
}
export interface EnhancementSelection {
    readonly smart: boolean;
    readonly forceSmart: boolean;
}
/** Resolve the two public toggles as one mutually exclusive startup choice. */
export declare function resolveEnhancementSelection(configuredSmart: boolean | undefined, configuredForceSmart: boolean | undefined, defaultSmart: boolean | undefined, defaultForceSmart: boolean | undefined): EnhancementSelection;
export declare function readEnhancementDefault(definition: EnhancementPrefsDefinition, dir?: string): boolean | undefined;
export declare function writeEnhancementDefault(definition: EnhancementPrefsDefinition, enabled: boolean, dir?: string): boolean;
export declare function readEnhancementSession(definition: EnhancementPrefsDefinition, sessionId: string, dir?: string): boolean | undefined;
export declare function writeEnhancementSession(definition: EnhancementPrefsDefinition, sessionId: string, enabled: boolean, dir?: string): boolean;
export declare function enhancementModeOf(definition: EnhancementPrefsDefinition, session: {
    header: Pick<SessionHeader, 'id' | 'seedLength'>;
    events: readonly SessionEvent[];
}, stored?: boolean | undefined): boolean;
export declare function resolvePersistedEnhancement(definition: EnhancementPrefsDefinition, ctx: {
    get(name: string): unknown;
}, sessionId: SessionId): Promise<boolean>;
//# sourceMappingURL=enhancementPrefs.d.ts.map