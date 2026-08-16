/** Mount the Smart-Pro Liangshen-style overlay around the selected base preset. */
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

type ForceBootstrapModule = {
  readonly apply: (ctx: Context, config: {
    readonly enabled?: boolean
    readonly promote?: () => void
    readonly resetAnchored?: boolean
  }) => unknown
}

interface ForceSmartEnhancementOptions {
  readonly enabled?: boolean
  readonly promote?: () => void
  readonly resetAnchored?: boolean
}

type WindowsBashModule = {
  readonly apply: (ctx: Context, config: {
    readonly bashPath?: string
    readonly timeoutMs?: number
    readonly maxOutputBytes?: number
  }) => unknown
}

let bootstrapModule: Promise<ForceBootstrapModule> | undefined
let windowsBashModule: Promise<WindowsBashModule> | undefined

const MINIMAL_BASH_DESCRIPTION = `Run commands in a bash shell
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* You don't have access to the internet via this tool.
* You do have access to a mirror of common linux and python packages via apt and pip.
* State is persistent across command calls and discussions with the user.
* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`

function assetEntry(file: string): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(moduleDir, '..', '..', '..', 'force-smart-assets', file),
    join(moduleDir, '..', '..', 'force-smart-assets', file),
  ]
  const found = candidates.find(existsSync)
  if (found === undefined) throw new Error(`dsh-tui Smart-Pro asset is missing: ${file}`)
  return found
}

async function loadBootstrap(): Promise<ForceBootstrapModule> {
  bootstrapModule ??= import(pathToFileURL(assetEntry('force-bootstrap.mjs')).href) as Promise<ForceBootstrapModule>
  return await bootstrapModule
}

async function loadWindowsBash(): Promise<WindowsBashModule> {
  windowsBashModule ??= import(pathToFileURL(assetEntry('windows-bash.mjs')).href) as Promise<WindowsBashModule>
  return await windowsBashModule
}

async function mountMinimalTools(
  hostCtx: Context,
  agentCtx: Context,
): Promise<boolean> {
  if (process.platform === 'win32') {
    try {
      const windowsBash = await loadWindowsBash()
      await agentCtx.plugin(windowsBash as unknown as {
        apply(ctx: Context, config: {
          readonly bashPath?: string
          readonly timeoutMs?: number
          readonly maxOutputBytes?: number
        }): unknown
      }, {
        bashPath: process.env.DSH_TUI_SMART_PRO_BASH_PATH ?? process.env.DSH_TUI_FORCE_SMART_BASH_PATH,
        timeoutMs: 300_000,
        maxOutputBytes: 64_000,
      })
    } catch (error) {
      hostCtx.logger.warn(
        `dsh-tui Smart-Pro: Windows Git Bash bootstrap unavailable; using the complete base preset (${error instanceof Error ? error.message : String(error)})`,
      )
      return false
    }
  } else {
    const shellCtx = agentCtx.isolate('terminals')
    await shellCtx.plugin(TerminalSessionService)
    await shellCtx.plugin(TerminalBash, { timeoutMs: 300_000 })
    await shellCtx.plugin(PersistentBash, {
      timeoutMs: 300_000,
      maxOutputChars: 16_000,
      description: MINIMAL_BASH_DESCRIPTION,
    })
  }
  await agentCtx.plugin(StrReplaceEditor, { maxOutputChars: 16_000 })
  return true
}

export async function mountForceSmartEnhancement(
  hostCtx: Context,
  agentCtx: Context,
  _basePreset?: string,
  options: ForceSmartEnhancementOptions = {},
): Promise<void> {
  const bootstrap = await loadBootstrap()
  const enabled = options.enabled !== false && await mountMinimalTools(hostCtx, agentCtx)
  if (!enabled && options.enabled !== false) {
    // The standing path defers the base preset until promotion, so a failed
    // minimal mount would otherwise strand the session with no tools at all
    // (the Windows Git-Bash miss). Binding the standing composition now
    // fails open to the complete preset; an explicit `enabled: false` keeps
    // its "fully disabled" semantics and does not promote.
    try {
      options.promote?.()
    } catch (error) {
      hostCtx.logger.warn(
        `dsh-tui Smart-Pro: base preset promotion failed after the minimal surface was unavailable (${error instanceof Error ? error.message : String(error)})`,
      )
    }
  }
  await agentCtx.plugin(
    bootstrap as unknown as {
      apply(ctx: Context, config: {
        readonly enabled?: boolean
        readonly promote?: () => void
        readonly resetAnchored?: boolean
      }): unknown
    },
    { ...options, enabled },
  )
  registerEnhancementAgent(hostCtx, agentCtx.agent as Agent, 'force-smart', childCtx => {
    // A delegated child keeps the toolFilter fixed by DSH setup. Smart-Pro
    // may narrow an existing compatible surface but never adds capabilities.
    bootstrap.apply(childCtx, {})
  })
}
