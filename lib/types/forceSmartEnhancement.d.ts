import type { Context } from '@deepseek-ai/cordis';
declare const markerPlugin: {
    name: string;
    inject: string[];
    apply(ctx: Context): void;
};
export declare function mountForceSmartEnhancement(hostCtx: Context, agentCtx: Context, basePreset?: string): Promise<void>;
export default markerPlugin;
//# sourceMappingURL=forceSmartEnhancement.d.ts.map