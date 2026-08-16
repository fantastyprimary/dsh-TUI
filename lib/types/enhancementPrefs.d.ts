export interface EnhancementSessionHeader {
    readonly id: unknown;
    readonly seedLength?: number;
}
export interface EnhancementSessionEvent {
    readonly type: string;
    readonly seq: number;
    readonly data?: unknown;
}
export interface EnhancementRequestHeader {
    readonly system?: string;
    readonly config?: {
        readonly maxTokens?: number;
    };
    readonly tools?: readonly {
        readonly name: string;
    }[];
}
export interface EnhancementPrefsDefinition {
    readonly file: string;
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
    header: EnhancementSessionHeader;
    events: readonly EnhancementSessionEvent[];
}, stored?: boolean | undefined): boolean;
export declare function resolvePersistedEnhancement(definition: EnhancementPrefsDefinition, ctx: {
    get(name: string): unknown;
}, sessionId: string): Promise<boolean>;
//# sourceMappingURL=enhancementPrefs.d.ts.map