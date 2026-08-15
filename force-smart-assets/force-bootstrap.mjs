/**
 * ForceSmart: a two-phase Anchored controller adapted for an enhancement
 * layered over an existing preset. It never owns the base preset or session
 * mode. A genuinely fresh request with an already-compatible catalog sees a
 * narrow shell/editor surface; persisted progress, fork history, governance
 * modes, and restricted child catalogs use the complete downstream assembly.
 *
 * Adapted from xiaobright/dsh-anchored-standard and dsh-liangshen. See NOTICE.
 */

export const name = 'dsh-tui-force-smart-bootstrap'
export const inject = ['systemPrompt']

const DEFERRED_MESSAGE_KINDS = new Set(['agent-instructions', 'skill-catalog'])
const MINIMAL_PERSONA = 'You are a helpful software engineer assistant.'
const FORCE_SMART_MARKER = '<!-- dsh-tui-force-smart:v1 -->'
const BOOTSTRAP_MAX_TOKENS = 1024
const MAX_BOOTSTRAP_STEPS = 4

export const MINIMAL_BASH_SCHEMA = {
  name: 'bash',
  description: `Run commands in a bash shell
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* You don't have access to the internet via this tool.
* You do have access to a mirror of common linux and python packages via apt and pip.
* State is persistent across command calls and discussions with the user.
* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`,
  parameters: {
    command: {
      type: 'string',
      required: true,
      description: 'The bash command to run. Relative path is preferred in the command.',
    },
  },
}

export const MINIMAL_EDITOR_SCHEMA = {
  name: 'str_replace_editor',
  description: `Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If \`path\` is a file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists non-hidden files and directories up to 2 levels deep
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* If a \`command\` generates a long output, it will be truncated and marked with \`<response clipped>\`

Notes for using the \`str_replace\` command:
* The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
* The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``,
  parameters: {
    command: {
      type: 'string',
      required: true,
      enum: ['view', 'create', 'str_replace', 'insert'],
      description: 'The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.',
    },
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.',
    },
    file_text: {
      type: 'string',
      description: 'Required parameter of `create` command, with the content of the file to be created.',
    },
    insert_line: {
      type: 'integer',
      description: 'Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.',
    },
    new_str: {
      type: 'string',
      description: 'Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.',
    },
    old_str: {
      type: 'string',
      description: 'Required parameter of `str_replace` command containing the string in `path` to replace.',
    },
    view_range: {
      type: 'array',
      items: { type: 'integer' },
      description: 'Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.',
    },
  },
}

const states = new WeakMap()

function stateFor(session) {
  let state = states.get(session)
  if (state === undefined) {
    state = {
      next: 0,
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
    else if (event?.type === 'request/header'
      && event.data?.header?.system?.includes(FORCE_SMART_MARKER)) state.promoted = true
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

function activePlan(assembled, session) {
  let durable = false
  for (const event of session.events) {
    if (event?.type === 'plan/mode') durable = event.data?.active === true
  }
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
  const ownedTools = new Set(Array.isArray(config.ownedTools) ? config.ownedTools : [])
  const downstream = assembled => ownedTools.size === 0
    ? assembled
    : { ...assembled, tools: assembled.tools.filter(tool => !ownedTools.has(tool.name)) }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const session = agent.session
    const state = stateFor(session)
    scan(state, session)
    if (state.promoted) return downstream(assembled)

    // A delegated task may be a one-shot child. Bootstrapping the real task
    // under a 1024-token cap can end the child before it ever promotes (the
    // failure behind Anchored Standard issue #15), so children start promoted.
    const delegated = Number(session.header?.delegationDepth ?? 0) > 0
      || session.header?.origin === 'subagent'
    if (delegated) {
      state.promoted = true
      return downstream(assembled)
    }

    // Plan/goal modes and restricted child agents remain fully usable.
    // They are promoted instead of receiving a partial, misleading surface.
    if (workflowActive(assembled, session)) {
      state.promoted = true
      return downstream(assembled)
    }

    const available = new Set(assembled.tools.map(tool => tool.name))
    if (!available.has('bash') || !available.has('str_replace_editor')) {
      warnOnce(
        ctx,
        state,
        'warnedMissingTools',
        'dsh-tui ForceSmart: Minimal bash/editor surface unavailable; using the complete base preset',
      )
      state.promoted = true
      return downstream(assembled)
    }

    return {
      ...assembled,
      // The first request must expose the official Minimal tool prompts even
      // when the compatible executor came from Standard or Cordis.
      tools: [MINIMAL_BASH_SCHEMA, MINIMAL_EDITOR_SCHEMA],
      contexts: [],
      sections: [{ name: 'persona', order: 0, text: MINIMAL_PERSONA, complete: true }],
    }
  }, { prepend: true })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const agent = payload.agent
    if (agent === undefined || decision.kind !== 'enter') return decision
    const state = stateFor(agent.session)
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
        `dsh-tui ForceSmart: bootstrap context filter failed; keeping all messages (${String(error)})`,
      )
      return decision
    }
  }, { prepend: true })

  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const agent = payload.agent
    if (agent === undefined) return resolved
    const state = stateFor(agent.session)
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
}
