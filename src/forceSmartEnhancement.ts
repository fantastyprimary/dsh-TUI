/** Mount the ForceSmart Anchored overlay after the selected base preset. */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import * as TerminalBash from '@deepseek-ai/dsh-terminal-bash'
import * as PersistentBash from '@deepseek-ai/dsh-tool-bash-persistent'
import * as StrReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor'
import { registerEnhancementAgent } from './enhancementInheritance.js'
import { FORCE_SMART_PROMPT_MARKER } from './forceSmartPrefs.js'

type ForceBootstrapModule = {
  readonly MINIMAL_BASH_SCHEMA: { readonly description: string }
  readonly apply: (ctx: Context, config: { readonly ownedTools?: readonly string[] }) => unknown
}

let bootstrapModule: Promise<ForceBootstrapModule> | undefined

function bootstrapEntry(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(moduleDir, '..', '..', 'force-smart-assets', 'force-bootstrap.mjs'),
    join(moduleDir, '..', 'force-smart-assets', 'force-bootstrap.mjs'),
  ]
  const found = candidates.find(existsSync)
  if (found === undefined) throw new Error('dsh-tui ForceSmart bootstrap asset is missing')
  return found
}

async function loadBootstrap(): Promise<ForceBootstrapModule> {
  bootstrapModule ??= import(pathToFileURL(bootstrapEntry()).href) as Promise<ForceBootstrapModule>
  return await bootstrapModule
}

async function mountMinimalTools(
  agentCtx: Context,
  bashDescription: string,
  allowAdditions: boolean,
): Promise<string[]> {
  const agent = agentCtx.agent as Agent
  const hasBash = agentCtx.tools.get('bash', agent) !== undefined
  const hasEditor = agentCtx.tools.get('str_replace_editor', agent) !== undefined
  const ownedTools: string[] = []

  // The official persistent PTY backend is Linux/macOS-only. Windows remains
  // fail-open unless the selected base preset already provides a real bash;
  // publishing a bash schema backed by pwsh would be a broken capability.
  if (allowAdditions && !hasBash && process.platform !== 'win32') {
    const shellCtx = agentCtx.isolate('terminals')
    await shellCtx.plugin(TerminalSessionService)
    await shellCtx.plugin(TerminalBash, { timeoutMs: 300_000 })
    await shellCtx.plugin(PersistentBash, {
      timeoutMs: 300_000,
      maxOutputChars: 16_000,
      description: bashDescription,
    })
    ownedTools.push('bash')
  }
  if (allowAdditions && !hasEditor) {
    await agentCtx.plugin(StrReplaceEditor, { maxOutputChars: 16_000 })
    ownedTools.push('str_replace_editor')
  }
  return ownedTools
}

const markerPlugin = {
  name: 'dsh-tui-force-smart-marker',
  inject: ['systemPrompt'],
  apply(ctx: Context) {
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembled = await next()
      if (assembled.sections.some(section => section.name === 'dsh-tui:force-smart')) return assembled
      return {
        ...assembled,
        sections: [{
          name: 'dsh-tui:force-smart',
          order: -90,
          text: `${FORCE_SMART_PROMPT_MARKER}\nForceSmart two-phase anchoring is active over the selected agent preset.`,
        }, ...assembled.sections],
      }
    })
  },
}

export async function mountForceSmartEnhancement(
  hostCtx: Context,
  agentCtx: Context,
  basePreset?: string,
): Promise<void> {
  const bootstrap = await loadBootstrap()
  // Code owns a collapsed run_code presentation. Adding native tools behind
  // that transport would silently change its generated SDK, so it fails open.
  const ownedTools = await mountMinimalTools(
    agentCtx,
    bootstrap.MINIMAL_BASH_SCHEMA.description,
    basePreset !== 'code',
  )
  await agentCtx.plugin(markerPlugin)
  await agentCtx.plugin(
    bootstrap as unknown as {
      apply(ctx: Context, config: { readonly ownedTools?: readonly string[] }): unknown
    },
    { ownedTools },
  )
  registerEnhancementAgent(hostCtx, agentCtx.agent as Agent, 'force-smart', childCtx => {
    // A delegated child keeps the toolFilter fixed by DSH setup. ForceSmart
    // may narrow an existing compatible surface but never adds capabilities.
    markerPlugin.apply(childCtx)
    bootstrap.apply(childCtx, {})
  })
}

export default markerPlugin
