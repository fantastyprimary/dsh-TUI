/** Compose the Smart overlay after the selected official agent preset. */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as StrReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor';
import { registerEnhancementAgent } from './enhancementInheritance.js';
import { SMART_PROMPT_MARKER } from './smartPrefs.js';
import SmartHostRuntime from './smartRuntime.js';
let routerModule;
const smartHosts = new WeakMap();
function routerEntry() {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(moduleDir, '..', '..', 'smart-assets', 'router-standard', 'router-bootstrap-v1.mjs'),
        join(moduleDir, '..', 'smart-assets', 'router-standard', 'router-bootstrap-v1.mjs'),
    ];
    const found = candidates.find(existsSync);
    if (found === undefined)
        throw new Error('dsh-tui Smart router asset is missing');
    return found;
}
async function loadRouter() {
    routerModule ??= import(pathToFileURL(routerEntry()).href);
    return await routerModule;
}
function ensureSmartHost(ctx) {
    const root = ctx.root;
    const existing = smartHosts.get(root);
    if (existing !== undefined)
        return existing;
    const started = (async () => {
        await root.plugin(SmartHostRuntime);
    })();
    smartHosts.set(root, started);
    return started;
}
const markerPlugin = {
    name: 'dsh-tui-smart-marker',
    inject: ['systemPrompt'],
    apply(ctx) {
        ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
            const assembled = await next();
            if (assembled.sections.some(section => section.name === 'dsh-tui:smart'))
                return assembled;
            return {
                ...assembled,
                sections: [{
                        name: 'dsh-tui:smart',
                        order: -91,
                        text: `${SMART_PROMPT_MARKER}\nSmart task routing is active over the selected agent preset.`,
                    }, ...assembled.sections],
            };
        });
    },
};
export async function mountSmartEnhancement(hostCtx, agentCtx, basePreset) {
    await ensureSmartHost(hostCtx);
    // Agent-local ownership keeps Code -> Standard blank-session recomposition
    // viable; an existing Minimal/custom editor must not be registered twice.
    // The Router hides this enhancement-owned tool on non-Standard bases.
    if (basePreset === 'standard'
        && agentCtx.tools.get('str_replace_editor', agentCtx.agent) === undefined) {
        await agentCtx.plugin(StrReplaceEditor, {});
    }
    await agentCtx.plugin(markerPlugin);
    const router = await loadRouter();
    await agentCtx.plugin(router, {});
    registerEnhancementAgent(hostCtx, agentCtx.agent, 'smart', childCtx => {
        // agent/created is synchronous and precedes session-start/first assembly.
        // Never register tools in a child-local scope: DSH tool restrictions are
        // applied earlier in child setup and must remain the final capability cap.
        markerPlugin.apply(childCtx);
        router.apply(childCtx, { registerTools: false });
    });
}
export default markerPlugin;
