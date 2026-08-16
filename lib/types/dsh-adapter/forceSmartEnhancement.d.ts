import type { Context } from '@deepseek-ai/cordis';
interface ForceSmartEnhancementOptions {
    readonly enabled?: boolean;
    readonly promote?: () => void;
    readonly resetAnchored?: boolean;
}
export declare function mountForceSmartEnhancement(hostCtx: Context, agentCtx: Context, _basePreset?: string, options?: ForceSmartEnhancementOptions): Promise<void>;
export {};
//# sourceMappingURL=forceSmartEnhancement.d.ts.map