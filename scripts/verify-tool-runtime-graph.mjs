#!/usr/bin/env node
/** Ensure the agent loop and tool scheduler resolve from one installed graph. */
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeModules = resolve(process.argv[2] ?? join(repoRoot, 'node_modules'))
const profileRequire = createRequire(join(nodeModules, '.dsh-runtime-graph.cjs'))

const agentLoopPackage = profileRequire.resolve('@deepseek-ai/dsh-agent-loop/package.json')
const profileToolsPackage = profileRequire.resolve('@deepseek-ai/dsh-tools/package.json')
const loopRequire = createRequire(agentLoopPackage)
const loopToolsPackage = loopRequire.resolve('@deepseek-ai/dsh-tools/package.json')

if (realpathSync(loopToolsPackage) !== realpathSync(profileToolsPackage)) {
  throw new Error(
    'agent loop and tool runtime resolve different @deepseek-ai/dsh-tools copies; '
    + 'tool calls would fail at the scheduler prepare stage',
  )
}

const agentLoop = JSON.parse(readFileSync(agentLoopPackage, 'utf8'))
const tools = JSON.parse(readFileSync(profileToolsPackage, 'utf8'))
if (agentLoop.version !== tools.version) {
  throw new Error(
    `agent loop/tools version mismatch: ${String(agentLoop.version)} != ${String(tools.version)}`,
  )
}

console.log(`tool runtime graph OK (agent-loop/tools ${String(tools.version)}, one module copy)`)
