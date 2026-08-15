import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-tui-smart-runtime";
export declare const inject: string[];
export declare const SUPER_INJECTOR_VERSION = "0.3.3";
export declare const SUPER_INJECTOR_BUNDLE_SHA256 = "5dbe8495cd8960267293c6a1f3e0f604b8c32665c02b980d03256cf41a966e38";
export declare const SUPER_INJECTOR_TOOL_NAMES: readonly ["dev_stage_add", "dev_stage_call", "dev_stage_list", "dev_stage_promote", "dev_stage_demote", "dev_inject_plugin", "dev_injected_list", "dev_uninject_plugin", "dev_clear_routes", "dev_reload_package", "dev_heal_links", "dev_fix_patch", "dev_plugin_status", "dev_install_package", "dev_scaffold_plugin", "dev_build_plugin", "dev_release_plugin", "dev_self_test"];
interface WebRoute {
    readonly kind: 'exact' | 'prefix' | 'upgrade';
    readonly path: string;
    readonly handler: unknown;
}
/** Minimal registry-only webServer contract used by the upstream host code. */
export declare class TerminalWebServerCompat {
    readonly exact: Map<string, WebRoute>;
    readonly prefixes: Map<string, WebRoute>;
    readonly upgrades: Map<string, WebRoute>;
    register(route: WebRoute): () => void;
}
export interface SmartHostLocation {
    readonly entry: string;
    readonly packageFile: string;
}
/** Resolve an explicit override, the active profile, then the suite's web profile. */
export declare function findSmartHostRuntime(home?: string, profile?: string, override?: string | undefined): SmartHostLocation | undefined;
export declare function verifySmartHostRuntime(location: SmartHostLocation): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export interface SmartRuntimeStatus {
    phase: 'router-only' | 'loading' | 'active' | 'failed';
    detail: string;
    source?: string;
}
export declare function apply(ctx: Context): Promise<void>;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=smartRuntime.d.ts.map