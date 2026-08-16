# 在 VS Code 中运行 dsh-TUI

[文档索引](README.md) · [English](vscode.en.md)

dsh-TUI 是终端程序：它把 ANSI 写进 PTY、从 PTY 读按键，因此任何兼容终端都能
承载它，包括 **VS Code 集成终端**（xterm.js）。本页覆盖两种用法：

1. **直接在内置终端里跑** —— 零安装，秒级可用；
2. **companion 扩展 `dsh-tui-vscode`** —— 一键启动/恢复、文件路径可点、
   `$VISUAL`/`$EDITOR` 指向 VS Code 等编辑器加成（
   [issue #161](https://github.com/ccch1mneyyy/dsh-TUI/issues/161) 的
   Path A MVP）。

## 方式一：VS Code 集成终端直接运行

前置条件与[快速开始](getting-started.md)一致：全局安装 `dsh` CLI 与 `dsh-tui`
（首次启动会自举 profile，需要 pnpm）。

1. 打开 VS Code 集成终端（`` Ctrl+` ``）：

   ```sh
   dsh-tui
   ```

2. 恢复上次会话：

   ```sh
   dsh-tui --resume
   ```

dsh-TUI 对 xterm.js（VS Code / Cursor / code-server）有专门的兼容路径：
truecolor 配色、OSC 8 链接（由 VS Code 直接渲染为可点击）、OSC 52 剪贴板
（首次使用 VS Code 会弹授权提示）、同步输出与平滑刷屏——这些在
`src/ink/` 中按 `TERM_PROGRAM=vscode` 探测分支处理。因此在内置终端里，
流式 Markdown、工具卡、滚动、双击 Esc 时间回溯等行为与独立终端一致。

### 让 `Ctrl+X` 用 VS Code 编辑当前输入

TUI 的 `Ctrl+X` 走 `$VISUAL`/`$EDITOR`。想让它在 VS Code 里编辑，把
`code -w` 写进终端环境（`settings.json` 中按平台设置，键名
`terminal.integrated.env.<platform>`）：

```jsonc
{
  "terminal.integrated.env.windows": { "VISUAL": "code -w" },
  "terminal.integrated.env.linux":   { "VISUAL": "code -w" },
  "terminal.integrated.env.osx":     { "VISUAL": "code -w" }
}
```

（若 `$VISUAL`/`$EDITOR` 都未设置，companion 扩展会自动导出 `code -w`，见下文。）

### 界面语言

`DSH_TUI_LANG` 默认中文；要英文界面，在上述 env 里加 `"DSH_TUI_LANG": "en"`。

### 已知差异（内置终端）

xterm.js 的能力上限决定：

| 能力 | 内置终端表现 |
| --- | --- |
| 鼠标滚轮/拖选 | 由集成终端处理；“松开即复制”在 VS Code 内表现为 OS 级复制行为 |
| 扩展键盘协议 | modifyOtherKeys / win32-input-mode 相关行为由 xterm.js 决定，可能与 kitty / WezTerm 不完全一致 |
| OSC 52 剪贴板 | 首次使用弹出权限提示（VS Code 自身的安全设计） |

需要完全对齐独立终端行为（如复杂鼠标语义）时，请使用独立终端窗口
（Windows Terminal / kitty / WezTerm / iTerm2 / tmux），或使用方式二的
Path B 会话面板（扩展自己的 webview 渲染，见下文）。

## 方式二：companion 扩展 dsh-tui-vscode（Path B）

[`baobaolaodie/dsh-tui-vscode`](https://github.com/baobaolaodie/dsh-tui-vscode)
用**真实 PTY（node-pty，Windows 走 ConPTY）+ Webview 内的 xterm.js** 把 dsh-tui
渲染进 VS Code **独立的会话面板**——活动栏 `dsh-tui` 图标 + 编辑器区面板，
**彻底脱离底部集成终端**，形态对齐 Claude Code 官方 VS Code 扩展。它不改动
TUI 核心渲染链路，只负责**承载**。

### 安装

```sh
git clone https://github.com/baobaolaodie/dsh-tui-vscode.git
cd dsh-tui-vscode
npm install
npm run package
code --install-extension dsh-tui-vscode-0.2.0.vsix --force
```

### 命令与编辑器加成

- 活动栏 `dsh-tui` 图标 → 侧边栏「会话控制」视图（启动/恢复/聚焦/终止 + 状态）；
  `dsh-tui: Open panel / 打开会话面板`、`dsh-tui: Start new session / 启动新会话`、
  `dsh-tui: Resume last session / 恢复上次会话`、`dsh-tui: Terminate session / 终止会话`
- 会话渲染在编辑器区面板：alt-screen、鼠标、OSC 52 剪贴板、OSC 8 链接、
  同步输出均由扩展自身承载；面板缩放自动 resize PTY
- 面板输出里的 `C:\...`、`/...`、`~/...`、`./...` 路径（含 `path:line[:col]`）可点击打开
- `$VISUAL`/`$EDITOR` 未设置时自动导出 `code -w`，`Ctrl+X` 直接进 VS Code
- OSC 11 背景查询按 VS Code 主题应答（TUI 自动选浅/深色）；OSC 0 标题同步到面板标题
- 关闭面板不终止会话（重开回到实时流）；隐藏面板完整保留渲染
- 状态栏 `dsh-tui` 项点击打开面板
- 配置项：`dsh-tui-vscode.command`、`extraArgs`、`lang`、`injectEditor`、
  `editorCommand`、`dshHome`（详见扩展 README）

### 限制与后续

- 关闭面板后滚动历史不保留（隐藏面板保留）；单会话模型。
- 协议能力以 xterm.js 为上限（扩展键盘协议、DEC 2026 等）；Path B 渲染完全
  自主，后续可在此 webview 上继续增强。
- vsix 含构建平台的 node-pty 二进制（Windows 构建即 Windows 可用）。
- dsh-TUI 本体保持“只做交互与呈现”的边界不变。

## 验收基线

按[贡献指南](contributing.md)的约定，VS Code 属于受支持的终端平台：任何
渲染改动请在 inline / fullscreen 两种模式、窄终端宽度下，于 VS Code
集成终端内走一遍启动、resize、滚动、输入、取消与干净退出。