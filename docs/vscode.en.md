# Running dsh-TUI in VS Code

[Documentation index](README.md) · [中文](vscode.md)

dsh-TUI is a terminal program: it writes ANSI into a PTY and reads keys back
from the PTY, so any compatible terminal can host it — including the **VS Code
integrated terminal** (xterm.js). This page covers two ways to use it:

1. **Run directly in the built-in terminal** — zero install, seconds to start;
2. **The `dsh-tui-vscode` companion extension** — one-click start/resume,
   clickable file paths, `$VISUAL`/`$EDITOR` pointing at VS Code
   ([issue #161](https://github.com/ccch1mneyyy/dsh-TUI/issues/161),
   Path A MVP).

## Option 1: run directly in the VS Code integrated terminal

Prerequisites match [Getting started](getting-started.en.md): install the `dsh`
CLI and `dsh-tui` globally (the first run bootstraps the profile; pnpm is
required).

1. Open the VS Code integrated terminal (`` Ctrl+` ``) and run:

   ```sh
   dsh-tui
   ```

2. Resume the last session:

   ```sh
   dsh-tui --resume
   ```

dsh-TUI has dedicated compatibility paths for xterm.js (VS Code / Cursor /
code-server): truecolor, OSC 8 links (rendered clickable by VS Code itself),
OSC 52 clipboard (VS Code prompts for permission on first use), synchronized
output and smooth draining — handled in `src/ink/` under the
`TERM_PROGRAM=vscode` detection branches. Streaming Markdown, tool cards,
scrolling, and double-Esc time travel behave the same as in a standalone
terminal.

### Make `Ctrl+X` edit the current input in VS Code

The TUI's `Ctrl+X` uses `$VISUAL`/`$EDITOR`. To edit in VS Code, export
`code -w` in the terminal environment (`settings.json`, key
`terminal.integrated.env.<platform>`):

```jsonc
{
  "terminal.integrated.env.windows": { "VISUAL": "code -w" },
  "terminal.integrated.env.linux":   { "VISUAL": "code -w" },
  "terminal.integrated.env.osx":     { "VISUAL": "code -w" }
}
```

(The companion extension exports `code -w` automatically when neither
`$VISUAL` nor `$EDITOR` is set — see below.)

### UI language

`DSH_TUI_LANG` defaults to Chinese; for the English UI, add
`"DSH_TUI_LANG": "en"` to the env block above.

### Known differences (built-in terminal)

The xterm.js capabilities cap what is possible:

| Capability | Behavior in the integrated terminal |
| --- | --- |
| Mouse wheel / drag selection | Handled by the integrated terminal; "copy on release" surfaces as OS-level copy behavior |
| Extended keyboard protocol | modifyOtherKeys / win32-input-mode behavior is decided by xterm.js and may differ from kitty / WezTerm |
| OSC 52 clipboard | First use triggers VS Code's own permission prompt |

For behavior identical to a standalone terminal (e.g. complex mouse
semantics), use an external terminal window (Windows Terminal / kitty /
WezTerm / iTerm2 / tmux) or the Path B session panel from Option 2 (the
extension's own webview rendering, below).

## Option 2: the dsh-tui-vscode companion extension (Path B)

[`baobaolaodie/dsh-tui-vscode`](https://github.com/baobaolaodie/dsh-tui-vscode)
runs dsh-tui inside a **dedicated session panel** — an activity-bar `dsh-tui`
icon plus an editor-area panel rendering the full TUI with a **real PTY
(node-pty, ConPTY on Windows) + xterm.js in a webview**, completely
independent of the integrated terminal. It does not touch the TUI's rendering
core — it only **hosts** it, shaped like the official Claude Code VS Code
extension.

### Install

```sh
git clone https://github.com/baobaolaodie/dsh-tui-vscode.git
cd dsh-tui-vscode
npm install
npm run package
code --install-extension dsh-tui-vscode-0.2.0.vsix --force
```

### Commands and editor integration

- Activity-bar `dsh-tui` icon → sidebar "会话控制" view (start / resume / focus /
  kill + status); `dsh-tui: Open panel / 打开会话面板`,
  `dsh-tui: Start new session / 启动新会话`, `dsh-tui: Resume last session / 恢复上次会话`,
  `dsh-tui: Terminate session / 终止会话`
- The session renders in the editor-area panel: alt-screen, mouse, OSC 52
  clipboard, OSC 8 links, synchronized output — all hosted by the extension;
  panel resize propagates to the PTY
- File paths in the output (`C:\...`, `/...`, `~/...`, `./...`, with
  `path:line[:col]`) are clickable and open in the editor
- Exports `code -w` as `$VISUAL` when unset, so `Ctrl+X` edits in VS Code
- OSC 11 background queries are answered with the VS Code theme; OSC 0 titles
  sync to the panel title
- Closing the panel keeps the session running (reopen reconnects to the live
  stream); hidden panels keep full rendering
- Status-bar `dsh-tui` item opens the panel
- Settings: `dsh-tui-vscode.command`, `extraArgs`, `lang`, `injectEditor`,
  `editorCommand`, `dshHome` (see the extension README)

### Limitations and next steps

- Scrollback is not preserved after the panel tab is closed (hidden panels
  keep it); single-session model.
- Protocol capabilities are bounded by xterm.js (extended keyboard protocol,
  DEC 2026, etc.); Path B keeps rendering fully under our control for future
  enhancements.
- The vsix contains the node-pty binary for the platform it was built on.
- dsh-TUI itself keeps its "interaction and presentation only" boundary
  unchanged.

## Acceptance baseline

Per [Contributing](contributing.en.md), VS Code is a supported terminal
platform: any rendering change should be walked through inside the VS Code
integrated terminal in both inline and fullscreen modes at narrow widths —
startup, resize, scroll, input, cancel, and clean exit.