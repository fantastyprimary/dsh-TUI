/**
 * Smart-Pro: a two-phase Anchored controller adapted for an enhancement
 * layered over an existing preset. It never owns the base preset or session
 * mode. A genuinely fresh request with an already-compatible catalog sees a
 * narrow shell/editor surface. Persisted progress and ordinary fork history
 * use the complete downstream assembly; explicit mode entry resets only the
 * Anchored phase while governance modes and restricted children still fail
 * open to the complete downstream assembly.
 *
 * Adapted primarily from dsh-liangshen, whose mechanism is based on
 * xiaobright/dsh-anchored-standard. See NOTICE.
 */

export const name = 'dsh-tui-force-smart-bootstrap'
export const inject = ['systemPrompt']

const DEFERRED_MESSAGE_KINDS = new Set(['agent-instructions', 'skill-catalog'])
const MINIMAL_PERSONA = 'You are a helpful software engineer assistant.'
const BOOTSTRAP_MAX_TOKENS = 1024
const MAX_BOOTSTRAP_STEPS = 4

const states = new WeakMap()

function stateFor(session, resetAnchored) {
  let state = states.get(session)
  if (state === undefined) {
    state = {
      // An explicit mode switch inherits the conversation, not the previous
      // mode's Anchored phase. Resume and ordinary forks still scan the full
      // durable history and therefore keep their already-promoted state.
      next: resetAnchored ? (session.header?.seedLength ?? 0) : 0,
      promoted: false,
      toolCalled: false,
      responded: false,
      anchored: false,
      turnEnded: false,
      steps: 0,
      originalMaxTokens: undefined,
      sawOriginalMaxTokens: false,
      injectedMaxTokens: false,
      warnedContextFilter: false,
      warnedMissingTools: false,
    }
    states.set(session, state)
  }
  return state
}

function firstReasoningIsAnchored(content) {
  if (!Array.isArray(content)) return false
  const block = content.find(entry => entry?.type === 'reasoning')
  if (block === undefined) return false
  const text = String(block.text ?? '')
  return /\bwe\b/i.test(text) && !/\blet me\b/i.test(text)
}

function scan(state, session) {
  for (; state.next < session.events.length; state.next += 1) {
    const event = session.events[state.next]
    const inherited = state.next < (session.header?.seedLength ?? 0)
    if (event?.type === 'tool/call') {
      state.toolCalled = true
      if (inherited) state.promoted = true
    }
    else if (event?.type === 'step/start') state.steps += 1
    else if (event?.type === 'turn/end') state.turnEnded = true
    else if (event?.type === 'assistant/message') {
      state.responded = true
      if (!state.anchored) state.anchored = firstReasoningIsAnchored(event.data?.message?.content)
    }
  }
  if (state.promoted) return
  if (state.toolCalled && (state.anchored || state.steps >= MAX_BOOTSTRAP_STEPS || state.turnEnded)) {
    state.promoted = true
  } else if (!state.toolCalled && (state.responded || state.turnEnded)) {
    state.promoted = true
  }
}

function activeGoal(session) {
  const change = session.events.findLast(event => event?.type === 'goal/change')?.data
  return change?.operation !== 'clear' && change?.goal?.phase === 'active'
}

function durablePlan(session) {
  let durable = false
  for (const event of session.events) {
    if (event?.type === 'plan/mode') durable = event.data?.active === true
  }
  return durable
}

function activePlan(assembled, session) {
  const durable = durablePlan(session)
  const section = assembled.sections?.find(entry => entry.name === 'plan:policy')
  return durable || (typeof section?.text === 'string' && section.text.trim().length > 0)
}

function workflowActive(assembled, session) {
  return activePlan(assembled, session) || activeGoal(session)
}

function warnOnce(ctx, state, key, message) {
  if (state[key]) return
  state[key] = true
  try { ctx.logger?.warn(message) } catch {}
}

function inheritedBootstrapCap(session) {
  const header = session.events.findLast(event => event?.type === 'request/header')?.data?.header
  if (header?.system !== MINIMAL_PERSONA || header?.config?.maxTokens !== BOOTSTRAP_MAX_TOKENS) return false
  const names = header.tools?.map(tool => tool.name) ?? []
  return names.length === 2 && names.includes('bash') && names.includes('str_replace_editor')
}

export function apply(ctx, config = {}) {
  const owner = ctx.agent
  const owns = agent => owner === undefined || agent === owner
  const enabled = config.enabled !== false
  const resetAnchored = config.resetAnchored === true
  let physicalPromoted = false

  function promotePhysical() {
    if (physicalPromoted) return
    if (typeof config.promote === 'function') config.promote()
    physicalPromoted = true
  }

  function refreshPromotion(session) {
    const state = stateFor(session, resetAnchored)
    scan(state, session)
    if (durablePlan(session) || activeGoal(session)) state.promoted = true
    if (state.promoted) promotePhysical()
    return state
  }

  ctx.on('session/event', (session) => {
    if (!enabled || owner === undefined || session !== owner.session) return
    refreshPromotion(session)
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const agent = context.agent
    if (!enabled || agent === undefined || !owns(agent)) return await next()
    const session = agent.session
    const state = refreshPromotion(session)
    if (state.promoted) {
      return await next()
    }

    // A delegated task may be a one-shot child. Bootstrapping the real task
    // under a 1024-token cap can end the child before it ever promotes (the
    // failure behind Anchored Standard issue #15), so children start promoted.
    const delegated = Number(session.header?.delegationDepth ?? 0) > 0
      || session.header?.origin === 'subagent'
    if (delegated) {
      state.promoted = true
      promotePhysical()
      return await next()
    }

    if (durablePlan(session) || activeGoal(session)) {
      state.promoted = true
      promotePhysical()
      return await next()
    }

    const assembled = await next()

    // Plan/goal modes and restricted child agents remain fully usable.
    // They are promoted instead of receiving a partial, misleading surface.
    if (workflowActive(assembled, session)) {
      state.promoted = true
      promotePhysical()
      return assembled
    }

    const available = new Set(assembled.tools.map(tool => tool.name))
    if (!available.has('bash') || !available.has('str_replace_editor')) {
      warnOnce(
        ctx,
        state,
        'warnedMissingTools',
        'dsh-tui Smart-Pro: Minimal bash/editor surface unavailable; using the complete base preset',
      )
      state.promoted = true
      // Bind the standing composition so the NEXT request (this one is
      // already assembled) runs with the complete base-preset surface.
      promotePhysical()
      return assembled
    }

    const bootstrap = new Set(['bash', 'str_replace_editor'])
    return {
      ...assembled,
      // Keep the exact schemas produced by DSH's registered executors. A
      // model-facing substitute would drift from execution-time validation.
      tools: assembled.tools.filter(tool => bootstrap.has(tool.name)),
      contexts: [],
      sections: [{ name: 'persona', order: 0, text: MINIMAL_PERSONA, complete: true }],
    }
  }, { prepend: true })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const agent = payload.agent
    if (!enabled || agent === undefined || !owns(agent) || decision.kind !== 'enter') return decision
    const state = stateFor(agent.session, resetAnchored)
    scan(state, agent.session)
    if (state.promoted) return decision
    try {
      if (!Array.isArray(decision.messages)) return decision
      return {
        ...decision,
        messages: decision.messages.filter(message =>
          !DEFERRED_MESSAGE_KINDS.has(message.source?.kind)),
      }
    } catch (error) {
      warnOnce(
        ctx,
        state,
        'warnedContextFilter',
        `dsh-tui Smart-Pro: bootstrap context filter failed; keeping all messages (${String(error)})`,
      )
      return decision
    }
  }, { prepend: true })

  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const agent = payload.agent
    if (!enabled || agent === undefined || !owns(agent)) return resolved
    const state = stateFor(agent.session, resetAnchored)
    scan(state, agent.session)
    if (!state.promoted && !state.sawOriginalMaxTokens) {
      state.originalMaxTokens = resolved.maxTokens
      state.sawOriginalMaxTokens = true
    }
    if (!state.promoted) {
      state.injectedMaxTokens = state.originalMaxTokens !== BOOTSTRAP_MAX_TOKENS
      return { ...resolved, maxTokens: BOOTSTRAP_MAX_TOKENS }
    }
    if (resolved.maxTokens !== BOOTSTRAP_MAX_TOKENS) return resolved
    if (!state.injectedMaxTokens && !inheritedBootstrapCap(agent.session)) return resolved
    if (state.originalMaxTokens === undefined) {
      const restored = { ...resolved }
      delete restored.maxTokens
      return restored
    }
    return { ...resolved, maxTokens: state.originalMaxTokens }
  }, { prepend: true })

  if (enabled && owner !== undefined) refreshPromotion(owner.session)
}
