/**
 * Agent-presets roster integration (issue #8): compose each session's
 * model-facing world (tools, prompt sections, projections) from one preset
 * directory instead of the host composition.
 *
 * Mirrors the official host's integration (dsh-host-apiproxy's
 * `composeAgent`): the preset id is resolved BEFORE create/resume because the
 * session boundary snapshots `meta` (the durable header's `agentPreset`)
 * before asynchronous setup begins; the mount itself runs inside the agent
 * factory's `setup(agentCtx)` hook, where a composition failure rolls the
 * whole creation back instead of publishing a half-configured agent.
 *
 * A deployment without the roster (bare `dsh --config cordis.yml` boots,
 * older CLI without the shipped preset root) composes nothing: callers get
 * no `setup` and every session shares the host composition — the behavior
 * before presets existed.
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentSetup } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { mountSmartEnhancement } from './smartEnhancement.js'
import { mountForceSmartEnhancement } from './forceSmartEnhancement.js'

const ASK_USER_TOOL = 'ask_user_question'

/** One roster entry, as returned by `agentPresets.list()`/`resolve()`. */
export interface AgentPresetInfo {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string
  readonly description?: string
  /** Present when the preset cannot compose a session (human-readable). */
  readonly broken?: string
}

/** The `ctx.agentPresets` service surface dsh-tui consumes. */
export interface AgentPresetsLike {
  readonly defaultId: string
  list(): Promise<readonly AgentPresetInfo[]>
  resolve(id?: string): Promise<AgentPresetInfo>
  mount(agentCtx: Context, id?: string): Promise<AgentPresetInfo>
  recompose(agentCtx: Context, id: string): Promise<AgentPresetInfo>
  /** Ensure a target preset is ready before an in-turn Smart-Pro promotion. */
  standingKeyFor?(id?: string): Promise<object>
  /** Read one service from the agent's own scope chain (preset realms). */
  serviceFor?(agent: { ctx: Context }, key: string): unknown
}

/**
 * The mounted preset roster, or undefined when the composition has no
 * `agent-presets` row (bare boots) — optional-service access via `ctx.get`.
 */
export function rosterOf(ctx: Context): AgentPresetsLike | undefined {
  return ctx.get('agentPresets') as AgentPresetsLike | undefined
}

/** The composition inputs for `agents.create`/`agents.resume`. */
export interface PresetComposition {
  /** Value for the durable header's `meta.agentPreset`; absent without a roster. */
  readonly agentPreset?: string
  /** Enhancement state after preset compatibility rules are applied. */
  readonly smart: boolean
  readonly forceSmart: boolean
  /** Factory setup hook mounting the preset onto the unpublished agent. */
  readonly setup?: AgentSetup
}

export interface PresetCompositionOptions {
  /** Ignore inherited completion state for this enhancement's first request. */
  readonly resetAnchored?: boolean
}

interface ScopeParentBindingLike {
  rebind(parent: object): void
}

interface ScopeRuntimeLike {
  scopeOf(ctx: Context): object | undefined
  bindScopeParent(key: object, parent: object): ScopeParentBindingLike
}

let scopeRuntimePromise: Promise<ScopeRuntimeLike> | undefined

function scopeRuntime(): Promise<ScopeRuntimeLike> {
  scopeRuntimePromise ??= (async () => {
    const presetsEntry = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent-presets')
    const scopeEntry = createRequire(presetsEntry).resolve('@deepseek-ai/dsh-scope')
    const loaded = await import(pathToFileURL(scopeEntry).href) as Partial<ScopeRuntimeLike>
    if (typeof loaded.scopeOf !== 'function' || typeof loaded.bindScopeParent !== 'function') {
      throw new Error('dsh-agent-presets scope runtime does not expose scopeOf/bindScopeParent')
    }
    return loaded as ScopeRuntimeLike
  })()
  return scopeRuntimePromise
}

async function preparePresetPromotion(agentCtx: Context, parent: object): Promise<() => void> {
  const scope = await scopeRuntime()
  const agentKey = scope.scopeOf(agentCtx)
  if (agentKey === undefined) throw new Error('dsh-tui: refusing to compose an unscoped agent context')
  let binding: ScopeParentBindingLike | undefined
  return () => {
    binding ??= scope.bindScopeParent(agentKey, parent)
  }
}

const FORCE_SMART_PERSONA = 'You are a helpful software engineer assistant.'
const FORCE_SMART_BOOTSTRAP_MAX_TOKENS = 1024

function isForceSmartBootstrapHeader(header: ReturnType<Agent['session']['requestHeader']>): boolean {
  if (header?.system !== FORCE_SMART_PERSONA || header.config.maxTokens !== FORCE_SMART_BOOTSTRAP_MAX_TOKENS) {
    return false
  }
  const names = header.tools?.map(tool => tool.name) ?? []
  return names.length === 2 && names.includes('bash') && names.includes('str_replace_editor')
}

/**
 * A text-only ForceSmart bootstrap can be the last request before the user
 * switches modes. Its 1024-token cap is request configuration, so DSH would
 * otherwise inherit it even after the prompt and tool surface are replaced.
 */
function mountForceSmartBootstrapCleanup(agentCtx: Context): void {
  const owner = agentCtx.agent as Agent
  agentCtx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    if (payload.agent !== owner
      || resolved.maxTokens !== FORCE_SMART_BOOTSTRAP_MAX_TOKENS
      || !isForceSmartBootstrapHeader(owner.session.requestHeader())) return resolved
    const { maxTokens: _bootstrapCap, ...cleaned } = resolved
    return cleaned
  }, { prepend: true })
}

/**
 * Resolve the preset one new/resumed session will run under and the setup
 * that installs it. `requested` undefined adopts the roster default.
 *
 * Resolution failures (unknown/broken preset id, an empty roster that cannot
 * supply even the default) degrade to the rosterless composition with a loud
 * log line: a session that cannot start at all is worse than one running on
 * the host composition.
 *
 * @param ctx - The plugin context (roster lookup + logging).
 * @param requested - The preset id the caller wants, or undefined for the default.
 * @returns The header value + setup hook, or an empty composition.
 */
export async function composePreset(
  ctx: Context,
  requested?: string,
  smart = false,
  forceSmart = false,
  options: PresetCompositionOptions = {},
): Promise<PresetComposition> {
  if (smart && forceSmart) throw new Error('Smart and Smart-Pro are mutually exclusive')
  const presets = rosterOf(ctx)
  if (presets === undefined) {
    if (smart) return {
      smart,
      forceSmart,
      setup: async agentCtx => {
        mountForceSmartBootstrapCleanup(agentCtx)
        await mountSmartEnhancement(ctx, agentCtx, undefined, options)
      },
    }
    if (forceSmart) return {
      smart,
      forceSmart,
      setup: agentCtx => mountForceSmartEnhancement(ctx, agentCtx, undefined, { ...options, enabled: false }),
    }
    return { smart, forceSmart, setup: agentCtx => mountForceSmartBootstrapCleanup(agentCtx) }
  }
  let resolvedId: string
  try {
    resolvedId = (await presets.resolve(requested)).id
  } catch (error) {
    ctx.logger.warn(
      `dsh-tui: agent preset ${requested === undefined ? '(default)' : `"${requested}"`} unavailable ` +
        `(${error instanceof Error ? error.message : String(error)}) — composing the session without a preset`,
    )
    if (smart) return {
      smart,
      forceSmart,
      setup: async agentCtx => {
        mountForceSmartBootstrapCleanup(agentCtx)
        await mountSmartEnhancement(ctx, agentCtx, undefined, options)
      },
    }
    if (forceSmart) return {
      smart,
      forceSmart,
      setup: agentCtx => mountForceSmartEnhancement(ctx, agentCtx, undefined, { ...options, enabled: false }),
    }
    return { smart, forceSmart, setup: agentCtx => mountForceSmartBootstrapCleanup(agentCtx) }
  }
  // Liangshen is a complete standalone bootstrap/promotion preset. Stacking
  // either overlay would run two independent promotion state machines and
  // could leave the visible tool surface in conflicting phases.
  const compatibleSmart = resolvedId === 'liangshen' ? false : smart
  const compatibleForceSmart = resolvedId === 'liangshen' ? false : forceSmart
  if ((smart || forceSmart) && resolvedId === 'liangshen') {
    ctx.logger.warn('dsh-tui: liangshen is a standalone preset; Smart and Smart-Pro are disabled for this session')
  }
  return {
    agentPreset: resolvedId,
    smart: compatibleSmart,
    forceSmart: compatibleForceSmart,
    setup: async (agentCtx: Context) => {
      if (compatibleForceSmart) {
        const standingKeyFor = presets.standingKeyFor
        if (standingKeyFor === undefined) {
          ctx.logger.warn('dsh-tui Smart-Pro: agent-presets.standingKeyFor unavailable; using the complete base preset')
          await presets.mount(agentCtx, resolvedId)
          await mountForceSmartEnhancement(ctx, agentCtx, resolvedId, { ...options, enabled: false })
        } else {
          const parent = await standingKeyFor.call(presets, resolvedId)
          const promote = await preparePresetPromotion(agentCtx, parent)
          await mountForceSmartEnhancement(ctx, agentCtx, resolvedId, { ...options, promote })
        }
      }
      else {
        await presets.mount(agentCtx, resolvedId)
      }
      if (compatibleSmart) {
        mountForceSmartBootstrapCleanup(agentCtx)
        await mountSmartEnhancement(ctx, agentCtx, resolvedId, options)
      }
      else if (!compatibleForceSmart) mountForceSmartBootstrapCleanup(agentCtx)
    },
  }
}

/**
 * The preset a PERSISTED session actually runs, read from its log: the last
 * `agent-preset/selected` event wins over the creation header (a blank
 * session may have switched). undefined when the log records none (sessions
 * from before presets existed → the roster default applies at mount).
 *
 * @param ctx - The plugin context (persistence lookup).
 * @param sessionId - The persisted session to inspect.
 * @returns The running preset id, or undefined when unrecorded/unreadable.
 */
export async function resolvePersistedPreset(ctx: Context, sessionId: SessionId): Promise<string | undefined> {
  const persistence = ctx.get('sessionPersistence') as
    | {
        load(id: SessionId): Promise<{
          meta: { agentPreset?: string }
          events: readonly { type: string; data: unknown }[]
        }>
      }
    | undefined
  if (persistence === undefined) return undefined
  try {
    const { meta, events } = await persistence.load(sessionId)
    return resolveSessionPreset({
      header: meta,
      events,
    } as Parameters<typeof resolveSessionPreset>[0])
  } catch {
    // A missing/corrupt artifact leaves resume itself to report the failure;
    // the preset lookup must not mask it with a second, misleading error.
    return undefined
  }
}

/**
 * The preset a LIVE session runs, resolved from its own log (last
 * `agent-preset/selected` wins over the header). Used for fork-style creates
 * (rewind/model switch) and for reading an already-live agent's composition.
 *
 * @param session - The live session (`header` + `events`).
 * @returns The running preset id, or undefined when the log records none.
 */
export function runningPresetOf(session: {
  header: { agentPreset?: string }
  events: readonly { type: string; data: unknown }[]
}): string | undefined {
  return resolveSessionPreset(session as Parameters<typeof resolveSessionPreset>[0])
}

/**
 * Keep the official Minimal preset's model-facing contract at exactly two
 * tools. The TUI mounts ask_user_question at the host layer so every other
 * preset (including user presets) can use its questionnaire UI; host-layer
 * tools otherwise merge into Minimal's scoped catalog as a third tool.
 *
 * This is a per-assembly filter rather than a startup-time decision because
 * one TUI process can resume, create, or recompose sessions under different
 * presets. The session log remains the source of truth for the active preset.
 *
 * @param assembly - Fully assembled prompt inputs for one model request.
 * @param presetId - Preset recorded for the requesting session.
 * @returns The original assembly, except ask_user_question is absent in Minimal.
 */
export function filterMinimalPresetTools(assembly: PromptAssembly, presetId: string | undefined): PromptAssembly {
  if (presetId !== 'minimal' || !assembly.tools.some(tool => tool.name === ASK_USER_TOOL)) return assembly
  return {
    ...assembly,
    tools: assembly.tools.filter(tool => tool.name !== ASK_USER_TOOL),
  }
}

/**
 * Read a service the way a joined agent sees it: through the preset scope
 * chain when a roster is mounted (preset realms hide e.g. `compaction` from
 * the root context), falling back to the host context otherwise. Mirrors the
 * official host's `agentPresets.serviceFor(agent, key) ?? ctx.get(key)`.
 *
 * @param ctx - The plugin context (roster + host fallback).
 * @param agent - The live agent whose scope chain resolves first.
 * @param key - The cordis service key.
 * @returns The service instance, or undefined when neither layer provides it.
 */
export function serviceForAgent<T>(ctx: Context, agent: { ctx: Context }, key: string): T | undefined {
  const presets = rosterOf(ctx)
  const scoped = presets?.serviceFor?.(agent, key)
  if (scoped !== undefined) return scoped as T
  return ctx.get(key) as T | undefined
}
