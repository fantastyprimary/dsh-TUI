/** Mount the ForceSmart Anchored overlay after the selected base preset. */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import TerminalSessionService from '@deepseek-ai/dsh-terminal';
import * as TerminalBash from '@deepseek-ai/dsh-terminal-bash';
import * as PersistentBash from '@deepseek-ai/dsh-tool-bash-persistent';
import * as StrReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor';
import { registerEnhancementAgent } from './enhancementInheritance.js';
let bootstrapModule;
let windowsBashModule;
function assetEntry(file) {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(moduleDir, '..', '..', '..', 'force-smart-assets', file),
        join(moduleDir, '..', '..', 'force-smart-assets', file),
    ];
    const found = candidates.find(existsSync);
    if (found === undefined)
        throw new Error(`dsh-tui ForceSmart asset is missing: ${file}`);
    return found;
}
async function loadBootstrap() {
    bootstrapModule ??= import(pathToFileURL(assetEntry('force-bootstrap.mjs')).href);
    return await bootstrapModule;
}
async function loadWindowsBash() {
    windowsBashModule ??= import(pathToFileURL(assetEntry('windows-bash.mjs')).href);
    return await windowsBashModule;
}
async function mountMinimalTools(hostCtx, agentCtx, bashDescription, allowAdditions) {
    const agent = agentCtx.agent;
    const hasBash = agentCtx.tools.get('bash', agent) !== undefined;
    const hasEditor = agentCtx.tools.get('str_replace_editor', agent) !== undefined;
    const ownedTools = [];
    if (allowAdditions && !hasBash) {
        if (process.platform === 'win32') {
            try {
                const windowsBash = await loadWindowsBash();
                await agentCtx.plugin(windowsBash, {
                    bashPath: process.env.DSH_TUI_FORCE_SMART_BASH_PATH,
                    timeoutMs: 300_000,
                    maxOutputBytes: 64_000,
                });
                ownedTools.push('bash');
            }
            catch (error) {
                hostCtx.logger.warn(`dsh-tui ForceSmart: Windows Git Bash bootstrap unavailable; using the complete base preset (${error instanceof Error ? error.message : String(error)})`);
            }
        }
        else {
            const shellCtx = agentCtx.isolate('terminals');
            await shellCtx.plugin(TerminalSessionService);
            await shellCtx.plugin(TerminalBash, { timeoutMs: 300_000 });
            await shellCtx.plugin(PersistentBash, {
                timeoutMs: 300_000,
                maxOutputChars: 16_000,
                description: bashDescription,
            });
            ownedTools.push('bash');
        }
    }
    if (allowAdditions && !hasEditor) {
        await agentCtx.plugin(StrReplaceEditor, { maxOutputChars: 16_000 });
        ownedTools.push('str_replace_editor');
    }
    return ownedTools;
}
export async function mountForceSmartEnhancement(hostCtx, agentCtx, basePreset) {
    const bootstrap = await loadBootstrap();
    // Code owns a collapsed run_code presentation. Adding native tools behind
    // that transport would silently change its generated SDK, so it fails open.
    const ownedTools = await mountMinimalTools(hostCtx, agentCtx, bootstrap.MINIMAL_BASH_SCHEMA.description, basePreset !== 'code');
    await agentCtx.plugin(bootstrap, { ownedTools });
    registerEnhancementAgent(hostCtx, agentCtx.agent, 'force-smart', childCtx => {
        // A delegated child keeps the toolFilter fixed by DSH setup. ForceSmart
        // may narrow an existing compatible surface but never adds capabilities.
        bootstrap.apply(childCtx, {});
    });
}
