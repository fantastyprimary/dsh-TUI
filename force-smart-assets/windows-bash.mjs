/**
 * ForceSmart's Windows bootstrap shell. DSH's persistent PTY Bash backend is
 * unavailable on win32, so this agent-scoped tool executes a real Git Bash
 * through the host subprocess service. It is adapted from Anchored Standard's
 * custom-bash adapter; see NOTICE for provenance.
 */

export const name = 'dsh-tui-force-smart-windows-bash'
export const inject = ['subprocess', 'tools']

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 64_000

export const WINDOWS_BASH_DESCRIPTION = [
  'Run commands in a bash shell (Git Bash on Windows)',
  '* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.',
  "* You don't have access to the internet via this tool.",
  '* State does NOT persist across command calls: each call runs in a fresh shell.',
  "* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.",
  '* Please avoid commands that may produce a very large amount of output.',
  '* NOTE: runs without OS sandbox confinement on Windows; treat commands and output as untrusted.',
].join('\n')

function addCandidate(candidates, seen, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return
  const key = candidate.toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  candidates.push(candidate)
}

/** Return explicit or conventional Git Bash locations in deterministic order. */
export function windowsBashCandidates(config = {}, environment = process.env) {
  const explicit = typeof config.bashPath === 'string' && config.bashPath.length > 0
    ? config.bashPath
    : undefined
  if (explicit !== undefined) return [explicit]

  const candidates = []
  const seen = new Set()
  for (const root of [
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
  ]) {
    if (typeof root !== 'string' || root.length === 0) continue
    addCandidate(candidates, seen, `${root}\\Git\\bin\\bash.exe`)
    addCandidate(candidates, seen, `${root}\\Git\\usr\\bin\\bash.exe`)
  }
  if (typeof environment.LOCALAPPDATA === 'string' && environment.LOCALAPPDATA.length > 0) {
    addCandidate(candidates, seen, `${environment.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`)
    addCandidate(candidates, seen, `${environment.LOCALAPPDATA}\\Programs\\Git\\usr\\bin\\bash.exe`)
  }
  addCandidate(candidates, seen, 'bash')
  return candidates
}

/** Windows' System32 bash.exe is a WSL launcher, not the Git Bash executor. */
export function isWindowsSubsystemLauncher(path) {
  return /[\\/]windows[\\/](?:system32|sysnative)[\\/]bash\.exe$/i.test(path)
}

/** Resolve Git Bash without accidentally accepting the WSL compatibility shim. */
export async function resolveWindowsBash(subprocess, config = {}, environment = process.env) {
  const failures = []
  for (const candidate of windowsBashCandidates(config, environment)) {
    try {
      const resolved = await subprocess.resolveExecutable(candidate)
      if (isWindowsSubsystemLauncher(resolved)) {
        failures.push(`${candidate}: resolved to the Windows Subsystem for Linux launcher`)
        continue
      }
      return resolved
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Git Bash executable unavailable (${failures.join('; ')})`)
}

/** Register the model-facing bash executor in the current top-level agent scope. */
export async function apply(ctx, config = {}) {
  const bashPath = await resolveWindowsBash(ctx.subprocess, config)
  const timeoutMs = Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : DEFAULT_TIMEOUT_MS
  const maxOutputBytes = Number.isSafeInteger(config.maxOutputBytes) && config.maxOutputBytes > 0
    ? config.maxOutputBytes
    : DEFAULT_MAX_OUTPUT_BYTES

  ctx.tools.register({
    name: 'bash',
    description: WINDOWS_BASH_DESCRIPTION,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The bash command to run. Relative path is preferred in the command.',
      },
    },
    timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
      const handle = ctx.subprocess.spawn({
        argv: [bashPath, '-c', args.command],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: maxOutputBytes },
          stderr: { maxBytes: maxOutputBytes },
        },
        graceMs: 3_000,
        ...(exec?.signal === undefined ? {} : { signal: exec.signal }),
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      const output = [stdout, stderr].filter(part => part.length > 0).join('\n')
      const text = output.length > 0
        ? output
        : `exit code: ${String(outcome.exitCode)}${outcome.signal === null ? '' : `; signal: ${outcome.signal}`} (no output)`
      if (outcome.exitCode !== 0) throw new Error(text)
      return { text }
    },
  })
}
