# Configuration

[Documentation index](README.md) · [简体中文](configuration.md)

## Profiles and patch layers

After an npm/profile installation, user configuration lives at:

```text
$DSH_HOME/profiles/dsh-tui/cordis.patch.yml
```

When `DSH_HOME` is unset, it normally defaults to `~/.dsh`. The file is a
top-level YAML array and may use the `!!js` expressions supported by DSH.

Profile startup layers `dsh-base`, installed bundles, the package's
`cordis.patch.yml`, and finally the user patch. A user configuration normally
overrides an existing row by `id`; use `insert` only for a genuinely new
service.

> When a row is overridden, its `config` block is replaced as a whole. It is
> not deep-merged, so repeat every key that must remain active.

## TUI configuration

A complete common override looks like this:

```yaml
- id: dsh-tui
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
    # Prefer leaving cwd unset — the default resolves to the git worktree
    # root containing the launch directory. To pin a fixed workspace, use an
    # absolute path (e.g. cwd: /repo/packages/app), NOT `!!js process.cwd()`
    # (that pins the workspace to the launch subdirectory, issue #96).
    effort: max
    activity: true
    activityFrames: claude
    contextBar: true
    fullscreen: false
    preset: !!js process.env.DSH_TUI_PRESET ?? undefined
    smart: !!js process.env.DSH_TUI_SMART === '1' ? true : process.env.DSH_TUI_SMART === '0' ? false : undefined
    forceSmart: !!js process.env.DSH_TUI_FORCE_SMART === '1' ? true : process.env.DSH_TUI_FORCE_SMART === '0' ? false : undefined
    sessionId: !!js process.env.DSH_TUI_RESUME_SESSION ?? undefined
```

| Field | Default/source | Meaning |
| --- | --- | --- |
| `provider` | `deepseek-official` | DSH model route |
| `model` | `deepseek-v4-flash` | Startup model; `/model` can switch through a session fork |
| `cwd` | git worktree root containing the launch directory (`process.cwd()` when outside any worktree; a dotfiles repo at `$HOME` does not count) | TUI-side session workspace: agent meta, `@` completion/mention expansion, /resume filtering, statusline; resuming an existing session adopts that session's persisted cwd. Note the bash/fs-policy/sandbox roots are still owned by the composition layer's cordis config (default: the launch directory, governed by dsh-base) and may differ from this session-side cwd |
| `effort` | normally `max` in the bundle | Reasoning effort actually applied to every request (validated against model levels; deepseek supports only off/high/max and invalid levels silently fall back to the adapter default; wins over the persisted `/effort` choice), also shown in the header at startup |
| `modes` | built-in trio | Shift+Tab session-mode cycle (plan/sandbox/approval atom bundles); defaults to default → plan → full-access |
| `activity` | `true` | Show the live activity row |
| `activityFrames` | persisted choice or `claude` | Activity animation preset; `/activity` changes it at runtime |
| `contextBar` | `true` | Segmented context-usage bar below the input box; `false` hides the row |
| `fullscreen` | `false` | `true` uses the alternate screen, app scrolling, and mouse selection; `false` uses inline mode |
| `preset` | roster default `standard` | Agent preset for new sessions; explicit configuration wins over persisted preference |
| `smart` | persisted choice or `false` | Enable Smart over the selected Agent preset |
| `forceSmart` | persisted choice or `false` | Enable ForceSmart over the selected Agent preset; mutually exclusive with Smart |
| `sessionId` | unset | Session to resume, normally injected by the Windows `--resume` launcher |

## Live activity row

`dsh-working-activity` is installed with the package and inserted by its patch.
Override only the existing ID when tuning it:

```yaml
- id: working-activity
  config:
    publishIntervalMs: 500
```

Do not insert a second row and do not separately run
`dsh plugin ... add dsh-working-activity` for the same profile.

## Agent presets

Each session composes its model-visible tools and prompt through
`@deepseek-ai/dsh-agent-presets`:

| ID | Name | Capability |
| --- | --- | --- |
| `standard` | Standard (default) | Editing, shell, search, skills, planning, goals, subagents, and workflows |
| `code` | PTC | Standard plus Code Mode SDK presentation for composing operations in TypeScript |
| `minimal` | Minimal | Persistent Bash and `str_replace_editor` only, without compaction |
| `cordis` | Creation | Standard plus runtime inspection and plugin-experimentation tools |

Usage rules:

- `/preset` opens the picker.
- `/preset <id>` selects directly; `/preset status` reports the current state.
- A blank session can switch in place. Once a conversation has started, the
  official blank-only rule stores the choice as the new default for `/new` or
  the next launch.
- The default is stored in `~/.dsh-tui/agent-preset.json`.
- Precedence is explicit `config.preset` or `DSH_TUI_PRESET`, then persisted
  preference, then the roster default `standard`.
- Resuming a session restores the preset recorded in that session's log and
  does not overwrite it with the current default.


### Smart and ForceSmart enhancements

Smart is not a fifth Agent preset. It is an orthogonal enhancement over
`standard`, `code`, `minimal`, `cordis`, or a user preset: `/preset` chooses
the base capability and `/smart on|off` controls Smart. Runtime switches
fork at the end of the current history. Messages are preserved while the
target agent reassembles its agent-scoped system prompt, dynamic context, tool
schemas, and services; the old session remains available through `/resume`. Set
`smart: true` or `DSH_TUI_SMART=1` to enable it for new sessions at startup.

Smart is based on [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite), pinned to suite `eb1b00d` and Router
v0.3.0. On `deepseek-v4-pro`, Smart uses Router Pro: maintenance/fix selects
the RL shell/editor interface, greenfield build selects the doer write-first
interface, and ambiguous input uses router-v2 few-shot. Flash and unknown
models keep Router Standard. These first-request prompt/context and tool
surfaces run only over the `standard` base preset; other presets retain their
complete native catalogs while receiving non-destructive classification and
near-field guidance. Top-level Standard Smart also mounts the required
`str_replace_editor`. Skills,
plugin tools, runtime policy contexts, and the complete Standard sections
return after the first durable `tool/call`; a tool-less first answer promotes
the next user turn, and `/smart on` over existing history starts promoted
instead of pretending to be a clean first request. Router Pro does not change
the request output budget. The suite's new `dsh-mode-boost` overlaps Router and
currently violates this TUI's first-message, promoted-context, and shell-less
child boundaries, so its provenance is recorded without double-mounting it.
`dev_mode_subagent` is an isolated,
output-bounded text consultation without a tool catalog; it is not an
executable task worker. Super Injector v0.3.3 is not redistributed because its upstream release declares
BSD-3-Clause but includes no LICENSE/NOTICE artifact. When the official payload
is already installed in the active or `web` profile, Smart verifies its version and host-bundle SHA-256
before mounting the complete upstream host tool set. `DSH_SMART_RUNTIME_PATH`
may point to that package directory. The terminal compatibility layer does not
start a web server, so the upstream browser settings panel is unavailable.
Once the optional host is active, its restore/watch loop and routes, timers,
services, or other side effects from dynamically loaded plugins may remain
process-global. `/smart off` removes the agent-scoped Smart prompt and Router
and hides known host management tools and context, but it does not unload
arbitrary injected plugins. Full isolation requires a separate process/profile;
stopping all activated host behavior requires restarting the current process.

ForceSmart is likewise neither a preset nor a Shift+Tab session mode. Control
it with `/force-smart on|off|status`, `forceSmart: true`, or
`DSH_TUI_FORCE_SMART=1`. Adapted from
[dsh-anchored-standard at `d97bec9`](https://github.com/xiaobright/dsh-anchored-standard/blob/d97bec91a3d668f4cf1d03ee5f20aae84fb6f85c/README.md) and
[dsh-web-ui's Liangshen mode](https://github.com/zhu1090093659/dsh-web-ui/blob/3647a33fa467e0335260468614f6eed04b196c38/packages/dsh-liangshen/README.zh.md). The product, command, and UI name remains ForceSmart only. On a compatible clean first request, the system prompt is byte-aligned with the official Minimal one-line persona; the request temporarily exposes only `bash` and `str_replace_editor`, with their model-facing prompts and schemas aligned to official Minimal. The execution layer reuses compatible tools already allowed by the base preset, mounts the official editor when absent at the top level, and mounts official persistent Bash on non-Windows top-level agents when Bash is absent. It defers ordinary agent instructions and
the skill catalog, and uses a 1024-token request budget. The complete base
preset sections, contexts, tools, and native budget return after an anchored
tool trajectory, a tool-less first answer, a turn boundary, or the bounded
safety fallback. Forked/resumed sessions with model history start promoted.
Current Anchored main has no default output cap. To remain a decoupled overlay,
ForceSmart does not replace the base preset's long-lived execution layer, but
its first request does align the two model-facing tool schemas with Minimal and
deliberately retains the fixed reference composition's 1024-token budget.
On native Windows, a missing Bash is supplied by an agent-scoped Git Bash
executor adapted from Anchored Standard. It runs `bash -c` through DSH's
subprocess service, is hidden from the model when the complete base catalog
(including `pwsh`) returns, and is disposed with the agent scope. It never
presents PowerShell as Bash. ForceSmart checks the
usual Git for Windows locations and `PATH`, rejects the System32 WSL launcher,
and accepts an explicit absolute path through
`DSH_TUI_FORCE_SMART_BASH_PATH`. Each Windows call starts a fresh shell and
runs without OS sandbox confinement. Resolution or registration failure is
loud and fails open to the complete base preset. WSL2 reports Linux and uses
DSH's persistent Bash backend, as do Linux and macOS. Smart independently uses
native `pwsh` on Windows and native `bash` on WSL2, Linux, and macOS.
Active `/plan`, active `/goal`, and all ForceSmart children start promoted and
pass through intact, preserving `exit_plan_mode`, goal, subagent, and workflow
control paths. ForceSmart does not reject, branch on, or warn for other model
IDs; it is silently available there, although the current tuning evidence is
primarily for the released DeepSeek V4 Pro.

Smart and ForceSmart are mutually exclusive. `/smart on` disables ForceSmart,
and `/force-smart on` disables Smart in the same single replacement-session
fork. Turning the active enhancement off does not restore the previous one.
Explicit configuration wins persisted defaults; ForceSmart wins when both
explicit booleans are true. State is stored separately in
`~/.dsh-tui/smart.json` and `~/.dsh-tui/force-smart.json`. Child-local request
headers override sidecars and inherited headers so `/resume`, rewind,
`/model`, `/new`, and workspace ownership recompose against the target session.

Native DSH spawn, fork, and continuable children inherit the parent's active
enhancement. The overlay never registers new tools in child scope or bypasses
the delegation `toolFilter`; child persona and delegation, sandbox, and approval
contexts are preserved. Smart may route within the already allowed catalog.
ForceSmart children start promoted so a one-shot delegated task cannot finish
inside the 1024-token bootstrap and lose its complete delegated capability set.

Place a custom preset at `$DSH_HOME/.agent-presets/<name>/` with an
`agent.cordis.yml` file. Under the default DSH home this is
`~/.dsh/.agent-presets/`.

Since 0.3, model-side tools, planning, compaction, and delegation are owned by
the preset. Profile mode no longer uses the old `DSH_TUI_COMPACT_RATIO`,
`DSH_TUI_COMPACT_RETAIN`, or the former TUI's subagent-depth customization; configure
those policies in the preset instead.

## MCP

The official `@deepseek-ai/dsh-mcp-client` supports both stdio and streamable
HTTP. Mounted tools are registered as `mcp__<server>__<tool>` and enter the
model tool set automatically.

Insert servers in the user `cordis.patch.yml`:

```yaml
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: context7
        command: npx
        args: ['-y', '@upstash/context7-mcp']

    - id: mcp-remote
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: remote
        url: https://example.com/mcp
        headers:
          Authorization: !!js process.env.MCP_TOKEN
```

Run `/mcp` to inspect connected servers and tool counts. Consult the
[DeepSeek Harness configuration catalog](https://deepseek-harness.github.io/deepseek-harness/reference/config-catalog#deepseek-ai-dsh-mcp-client)
for the complete field reference.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `VISUAL` / `EDITOR` | External editor opened by `Ctrl+X` (`VISUAL` wins; arguments like `code --wait` are allowed; POSIX falls back to `vi`) |
| `DEEPSEEK_API_KEY` | Required DeepSeek credential |
| `DEEPSEEK_BASE_URL` | Override the compatible DeepSeek API endpoint |
| `DSH_TUI_PERSONA` | Override the Agent persona injected by the composition |
| `DSH_TUI_PRESET` | Override the default Agent preset for new sessions |
| `DSH_TUI_SMART` | `1`/`0`: override the Smart enhancement default for new sessions |
| `DSH_TUI_FORCE_SMART` | `1`/`0`: override the ForceSmart enhancement default for new sessions |
| `DSH_TUI_FORCE_SMART_BASH_PATH` | Optional on Windows: absolute Git Bash `bash.exe` path used by the ForceSmart bootstrap |
| `DSH_SMART_RUNTIME_PATH` | Optional Smart host runtime package directory or `lib/index.js` path |
| `DSH_TUI_THEME` | Pin a built-in (`auto`/`light`/`dark`/`dark-ansi`) or custom theme ahead of persisted selection |
| `DSH_TUI_DISABLE_MOUSE` | Temporarily disable mouse handling in fullscreen mode |
| `DSH_TUI_RESUME_SESSION` | Resume a session at startup, normally set by a launcher |
| `DSH_TUI_SESSION_ROOT` | Override the JSONL session root; profile default `$DSH_HOME/sessions`, bare `cordis.yml` default `~/.dsh-tui/sessions` |
| `DSH_PERMISSION_MODE` | Override non-Windows sandbox policy, such as `workspace-write` or `danger-full-access` |
| `DSH_TUI_WORKSPACE` | Working directory used by the Windows `dsh-tui.cmd` launcher |
| `DSH_TUI_DEBUG` | Enable dsh-tui diagnostics on stderr |
| `DSH_TUI_RENDER_LOG` | File path for raw ANSI frame capture |

The old `CC_TUI_*` and `DSH_CC_*` names no longer take effect as of this
release; startup prints one warning line whenever a legacy name is still set
(repeated on every launch while it remains set). The only exception is
`DSH_TUI_RESUME_SESSION`: the reader prefers the new name but still accepts
the old `DSH_CC_RESUME_SESSION`, and the writer sets both variables to ease
the transition for older launchers.

`DSH_TUI_RENDER_LOG` may capture visible prompts, tool arguments, and output.
Do not attach it to a public issue without reviewing and redacting it.

## `/provider`: add a model provider at runtime

`/provider` opens an interactive wizard that adds a model provider without a
restart:

- **Built-in provider**: pick a catalog route (openai, anthropic, deepseek, …)
  from `llm.listConfigurableProviders()`; only the API key is required. The
  baseURL can optionally be overridden (proxy gateways); the protocol and
  model catalog are inherited.
- **Custom API endpoint**: enter a route name, API key, baseURL, and the wire
  protocol (`openai-completions` / `openai-responses` / `anthropic-messages`).
  The wizard probes the endpoint with the draft credential and offers the
  advertised models for selection (manual id entry as fallback).

What gets written (on a profile start, where dsh-base provides the
settings/credentials services):

| Artifact | Location |
| --- | --- |
| Provider profile | `llm-pi-ai.providers.<route>` in `~/.dsh/settings.yaml`; the route registers on write |
| API key | `~/.dsh/.credentials.yaml` (mode 0600), referenced as `<ROUTE>_API_KEY` |

Key answers render as `••••••` in the transcript; when the process environment
already provides the same-named variable, the write is skipped and the value
resolves from the environment at request time. The configuration is shared
with the dsh web UI's Models settings page (same settings section). A bare
`dsh --config cordis.yml` start lacks these services and `/provider` reports
itself unavailable. After adding, run `/model` to switch to the new route's
models.

## Composition constraints

- `user-interaction` normally comes from `dsh-base`. The plugin creates a
  fallback in a bare composition, but the profile patch must not insert a
  duplicate.
- When manually inserting a subagent provider, mount the core `subagent`
  service first.
- A custom `plan-mode` override requires a non-empty `section`.
- Profile mode uses the base JSONL persistence row rooted at the shared
  `~/.dsh/sessions`, allowing TUI and Web to read the same history.
- `cordis.yml` is a bare-composition example and may have a different service
  topology. Normal installation and user overrides should follow
  `cordis.patch.yml`.

`DSH_TUI_SESSION_ROOT` always names a JSONL root. `dsh --profile dsh-tui`
defaults to `$DSH_HOME/sessions` (normally `~/.dsh/sessions/`); direct
`dsh --config cordis.yml` defaults to `~/.dsh-tui/sessions/`.

See [Architecture and limitations](architecture.en.md#permissions-and-security-boundary)
for permission behavior and platform differences.
