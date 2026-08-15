# 配置参考

[文档索引](README.md) · [English](configuration.en.md)

## Profile 与补丁层

通过 npm/profile 机制安装后，用户配置位于：

```text
$DSH_HOME/profiles/dsh-tui/cordis.patch.yml
```

`DSH_HOME` 未设置时通常为 `~/.dsh`。该文件是顶层 YAML 数组，可使用 DSH
支持的 `!!js` 表达式。

Profile 启动按顺序叠加 `dsh-base`、已安装 bundle、`@deepseek-harness-tui/dsh-tui`
的包内 `cordis.patch.yml`，最后再应用用户补丁。用户配置通常通过相同 `id` 覆盖已有行；
只有确实新增服务时才使用 `insert`。

> 覆盖某一行时，`config` 是整块替换，不是逐字段深合并。需要继续生效的字段必须
> 在用户补丁中全部重写。

## TUI 配置

下面是完整的常用覆盖示例：

```yaml
- id: dsh-tui
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
    # cwd 不建议显式设置——默认解析为启动目录所在的 git 仓库根；确需固定
    # 工作区时写绝对路径（如 cwd: /repo/packages/app），不要用
    # `!!js process.cwd()`（那会把工作区钉死在启动子目录上，issue #96）。
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

| 字段 | 默认/来源 | 说明 |
| --- | --- | --- |
| `provider` | `deepseek-official` | DSH 模型路由名称 |
| `model` | `deepseek-v4-flash` | 启动模型；`/model` 可通过 session fork 实时切换 |
| `cwd` | 所在 git 仓库根目录（不在任何仓库内时为 `process.cwd()`；家目录的 dotfiles 仓不算） | TUI 会话侧工作区：agent meta、`@` 补全/提及展开、/resume 过滤、状态栏；恢复已有会话时以该会话持久化的 cwd 为准。注意 bash/fs-policy/sandbox 的根仍由组合层 cordis 配置决定（默认启动目录，归 dsh-base 管），与这里的会话侧 cwd 可能不同 |
| `effort` | 配置层通常为 `max` | 每个请求实际生效的推理等级（按模型档位校验，deepseek 仅 off/high/max，非法档位静默回落默认；优先于 `/effort` 持久化选择），兼作顶栏启动显示 |
| `modes` | 内置三档 | Shift+Tab 会话模式循环（plan/sandbox/approval 原子组合）；缺省为 默认 → 计划 → 完全访问 |
| `activity` | `true` | 是否显示实时工作状态行 |
| `activityFrames` | 持久化选择或 `claude` | 工作状态动画预设；也可通过 `/activity` 修改 |
| `contextBar` | `true` | 输入框下方的分段上下文进度条；`false` 隐藏该行 |
| `fullscreen` | `false` | `true` 使用 alternate screen、应用内滚动和鼠标选区；`false` 使用 inline 模式 |
| `preset` | 名册默认 `standard` | 新会话 Agent preset；显式配置优先于持久化偏好 |
| `smart` | 持久化选择或 `false` | 在所选 Agent preset 上启用 Smart 增强 |
| `forceSmart` | 持久化选择或 `false` | 在所选 Agent preset 上启用 ForceSmart；与 Smart 互斥 |
| `sessionId` | 未设置 | 要恢复的会话 ID，通常由 Windows `--resume` 启动器注入 |

## 工作状态行

`dsh-working-activity` 随包安装，并由本包 patch 插入。只需要按 ID 覆盖参数：

```yaml
- id: working-activity
  config:
    publishIntervalMs: 500
```

不要再次 `insert` 同名行，也不要对同一 profile 单独执行
`dsh plugin ... add dsh-working-activity`。

## Agent Preset

每个会话通过 `@deepseek-ai/dsh-agent-presets` 组合模型可见的工具和提示词：

| ID | 名称 | 能力 |
| --- | --- | --- |
| `standard` | 标准模式（默认） | 编辑、Shell、检索、Skills、计划、Goals、子代理与工作流 |
| `code` | PTC 模式 | 标准能力，加 Code Mode SDK 呈现工具，可用 TypeScript 组合多步操作 |
| `minimal` | 极简模式 | 仅持久 Bash 与 `str_replace_editor`，不带 compaction |
| `cordis` | 创造模式 | 标准能力，加运行时检查与插件实验工具 |

使用方式：

- `/preset` 打开选择器。
- `/preset <id>` 直接选择；`/preset status` 查看当前状态。
- 空白会话可以原地切换。已经产生对话的会话遵循官方 blank-only 规则，选择只会
  保存为新默认值，在 `/new` 或下一次启动时生效。
- 默认值保存在 `~/.dsh-tui/agent-preset.json`。
- 优先级为：显式 `config.preset` 或 `DSH_TUI_PRESET`，然后持久化偏好，最后名册
  默认值 `standard`。
- 恢复旧会话时，以该会话日志记录的 preset 为准，不读取当前默认值覆盖它。


### Smart 与 ForceSmart 增强

Smart 不是第五个 Agent preset，而是叠加在 `standard`、`code`、`minimal`、
`cordis` 或用户 preset 上的正交增强：`/preset` 决定基础能力，`/smart on|off`
决定是否启用 Smart。运行时切换会在当前历史末尾 fork；对话消息保持不变，
目标 agent 会重新组装 agent-scoped system prompt、动态 context、工具 schema 和相关
服务，旧会话仍可在 `/resume` 恢复。`smart: true` 或 `DSH_TUI_SMART=1` 可让新会话
启动即启用。

Smart 基于 [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)，固定到
suite `eb1b00d` 与 Router v0.3.0。Smart 在 `deepseek-v4-pro` 上使用新的 Router Pro
策略：维护/修复选择 RL shell/editor 接口，新建/构建选择 doer write-first 接口，
无明确证据时使用 router-v2 few-shot；Flash 与未知模型继续使用 Router Standard。
这些首轮 prompt/context 与工具面只在基础 preset 为 `standard` 时启用；其他 preset
保留自己的完整工具目录，同时使用非破坏性的任务分类、near-field 引导和 router
管理工具。Standard 的顶层 Smart 会额外挂载路由所需的 `str_replace_editor`；Skills、
插件工具和运行时 policy context 会在首次持久
`tool/call` 后随完整 Standard sections 与工具目录恢复；若首答没有工具调用，则下一
用户轮恢复；在已有历史上运行 `/smart on` 会直接使用恢复后的表面，不会重新伪装成
干净首轮。Router Pro 不修改请求输出预算。suite 新增的 `dsh-mode-boost` 与 Router
重复注入，且其当前首轮、promoted contexts 和无 Shell 子代理行为不满足本 TUI 的
兼容边界，因此只记录来源而不双重挂载。`dev_mode_subagent` 只是无工具目录、
有输出上限的隔离文本咨询，不等同于可执行任务的 worker。Super Injector v0.3.3
因上游发布物缺少 LICENSE/NOTICE 文件
而不随包再分发；若官方 payload 已安装在当前或 `web` profile，
Smart 会校验版本与 host bundle SHA-256 后挂载完整上游 host 工具。也可用
`DSH_SMART_RUNTIME_PATH` 指向该包目录。TUI 兼容层不启动 Web 服务，因此上游浏览器
设置面板不可用。可选 host 一旦激活，其 restore/watch 以及动态插件产生的 route、timer、
service 和其他副作用可能是进程级；`/smart off` 会移除 agent-scoped Smart prompt/Router，
并隐藏已知 host 管理工具与 context，但不会卸载任意已注入插件。完全隔离需要使用独立
进程/profile；关闭已激活 host 的全部进程级行为需要重启当前进程。

ForceSmart 同样不是 preset 或 Shift+Tab session mode；使用 `/force-smart on|off|status`、
`forceSmart: true` 或 `DSH_TUI_FORCE_SMART=1` 控制。它参考固定到 `d97bec9` 的
[dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/blob/d97bec91a3d668f4cf1d03ee5f20aae84fb6f85c/README.zh-CN.md)
与 [dsh-web-ui 的“梁神模式”](https://github.com/zhu1090093659/dsh-web-ui/blob/3647a33fa467e0335260468614f6eed04b196c38/packages/dsh-liangshen/README.zh.md)，
但产品、命令与界面名称始终只使用 ForceSmart。在兼容的干净首轮，system prompt
精确对齐官方 Minimal 的单行 persona，临时只暴露 `bash` 和 `str_replace_editor`，并将
两者的模型可见提示与 schema 对齐官方 Minimal；执行层优先复用基础 preset 已允许的
兼容工具，顶层缺少 editor 时挂载官方实现，非 Windows 顶层缺少 Bash 时挂载官方
persistent Bash。Windows 原生环境缺少 Bash 时，ForceSmart 按 Anchored 的做法在当前
顶层 agent scope 注册真实 Git Bash executor，通过 DSH subprocess 执行 `bash -c`；晋升后
从模型可见目录隐藏该临时工具并恢复基础 preset 的 `pwsh` 与完整目录，agent dispose 时
再由 Cordis scope 回收执行器。它会依次检查 Git for Windows
常见安装路径和 `PATH`，并拒绝把 System32 的 WSL launcher 当成 Git Bash；可用
`DSH_TUI_FORCE_SMART_BASH_PATH` 指定自定义绝对路径。Windows executor 每次调用启动新
shell，且没有 OS sandbox confinement；找不到 Git Bash 或注册失败时会明确告警并完整
fail-open。WSL2 的 `process.platform` 是 Linux，因此走官方 persistent Bash 路径，不依赖
Windows Git Bash。ForceSmart 同时延后普通 agent instructions/skill catalog，并把请求预算
设为 1024；首次工具轨迹满足 Anchored 门控、首答无工具、turn 结束或安全兜底后，恢复
基础 preset 的完整 sections、contexts、工具及原请求预算。已有历史的 fork/resume 直接
使用恢复后的表面。Anchored 当前主线默认不封顶；ForceSmart 为保持 overlay 解耦，
不替换基础 preset 的长期执行层，但首轮模型可见的两工具 schema 与 Minimal 对齐，并
有意保留固定参考组合中的 1024 首轮预算。Windows 不会把 `pwsh` 冒充 Bash；无法形成
兼容两工具表面时直接 fail-open。Smart 在 Windows 使用原生 `pwsh`，在 WSL2/Linux/macOS
使用原生 `bash`；ForceSmart 在这些平台分别使用上述 Git Bash 或 persistent Bash 首轮后
恢复基础 preset。活跃 `/plan`、活跃 `/goal` 与所有 ForceSmart 子代理
会直接从 promoted 阶段完整放行，
因此 `exit_plan_mode`、goal、subagent 和 workflow 不会失去退出/控制路径。ForceSmart 不
检查或限制模型 ID：非 V4 Pro 模型静默可用，但当前实验调校证据主要来自正式版
DeepSeek V4 Pro。

Smart 与 ForceSmart 互斥。`/smart on` 会自动关闭 ForceSmart，`/force-smart on` 会自动
关闭 Smart，且每次只创建一个 replacement session；关闭当前增强不会恢复之前的另一个。
显式配置优先于持久默认，若两项显式同时为 `true`，ForceSmart 胜出。状态分别保存在
`~/.dsh-tui/smart.json` 与 `~/.dsh-tui/force-smart.json`；session-local request header
优先于 sidecar 和继承 header，确保 `/resume`、rewind、`/model`、`/new` 与 workspace
归属按目标 session 重组。

DSH 原生 spawn、fork 与 continuable 子代理继承父级当前增强。增强不会在 child scope
新增工具或绕过委派 `toolFilter`；子代理自己的 persona、delegation、sandbox 与 approval
contexts 始终保留。Smart 可在已允许的目录内路由；ForceSmart 子代理直接从 promoted
阶段开始，避免一次性委托在 1024-token bootstrap 中结束后永远无法恢复完整能力。

自定义 preset 放在 `$DSH_HOME/.agent-presets/<name>/`，目录中应包含
`agent.cordis.yml`。默认 `DSH_HOME` 下的路径即 `~/.dsh/.agent-presets/`。

从 0.3 起，模型侧工具、plan、compaction、delegation 等由 preset 自己组合。
Profile 模式不再使用旧的 `DSH_TUI_COMPACT_RATIO`、
`DSH_TUI_COMPACT_RETAIN` 或旧版 TUI 的深度限制；这些策略应在 preset 中配置。

## MCP

官方 `@deepseek-ai/dsh-mcp-client` 同时支持 stdio 与 streamable HTTP。
每个服务挂载后，工具以 `mcp__<server>__<tool>` 注册并自动进入模型工具集。

在用户 `cordis.patch.yml` 中插入：

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

运行 `/mcp` 查看已连接服务与工具数量。完整字段以
[DeepSeek Harness 配置目录](https://deepseek-harness.github.io/deepseek-harness/reference/config-catalog#deepseek-ai-dsh-mcp-client)
为准。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `VISUAL` / `EDITOR` | `Ctrl+X` 打开的外部编辑器（`VISUAL` 优先，可带参数如 `code --wait`；未设置时 POSIX 回退 `vi`） |
| `DEEPSEEK_API_KEY` | DeepSeek 凭证；运行模型的必需项 |
| `DEEPSEEK_BASE_URL` | 覆盖 DeepSeek 兼容 API 端点 |
| `DSH_TUI_PERSONA` | 覆盖组合注入的 Agent persona |
| `DSH_TUI_PRESET` | 覆盖新会话默认 Agent preset |
| `DSH_TUI_SMART` | `1`/`0`：覆盖新会话 Smart 增强默认值 |
| `DSH_TUI_FORCE_SMART` | `1`/`0`：覆盖新会话 ForceSmart 增强默认值 |
| `DSH_TUI_FORCE_SMART_BASH_PATH` | Windows 可选：ForceSmart 首轮使用的 Git Bash `bash.exe` 绝对路径 |
| `DSH_SMART_RUNTIME_PATH` | Smart 可选 host runtime 包目录或 `lib/index.js` 路径 |
| `DSH_TUI_THEME` | 锁定内置（`auto`/`light`/`dark`/`dark-ansi`）或自定义主题，优先于持久化选择 |
| `DSH_TUI_DISABLE_MOUSE` | 在 fullscreen 模式临时关闭鼠标处理 |
| `DSH_TUI_RESUME_SESSION` | 启动时恢复指定会话，通常由启动器设置 |
| `DSH_TUI_SESSION_ROOT` | 覆盖 JSONL 会话根目录；profile 默认 `$DSH_HOME/sessions`，裸 `cordis.yml` 默认 `~/.dsh-tui/sessions` |
| `DSH_PERMISSION_MODE` | 非 Windows 平台覆盖 sandbox policy，例如 `workspace-write` 或 `danger-full-access` |
| `DSH_TUI_WORKSPACE` | Windows `dsh-tui.cmd` 采用的工作目录 |
| `DSH_TUI_DEBUG` | 启用写往 stderr 的 dsh-tui 调试日志 |
| `DSH_TUI_RENDER_LOG` | 指定文件路径，记录原始 ANSI 渲染帧用于取证 |

旧名 `CC_TUI_*` 与 `DSH_CC_*` 自本版本起不再生效；启动时检测到旧名仍被设置会
打印一行警告（只要还设着，每次启动都会提示）。唯一例外是
`DSH_TUI_RESUME_SESSION`：读端优先取新名、同时仍读取旧名
`DSH_CC_RESUME_SESSION`，写端两个变量都会设置，供旧版启动器过渡。

`DSH_TUI_RENDER_LOG` 可能捕获屏幕上可见的提示词、工具参数和输出，不应上传到
公开 issue，除非已经检查并脱敏。

## `/provider`：运行时添加模型提供方

`/provider` 打开交互向导，无需重启即可添加模型提供方：

- **内置 provider**：从 `llm.listConfigurableProviders()` 列出的 catalog
  路由（openai、anthropic、deepseek 等）中选择，只需输入 API key；baseURL
  可选覆盖（代理网关场景），协议与模型目录自动继承。
- **自定义 API 端点**：输入路由名、API key、baseURL 与协议
  （`openai-completions` / `openai-responses` / `anthropic-messages`），
  向导会用草稿凭据探测端点公布的模型供勾选（探测失败则手输模型 id）。

写入产物（profile 启动时，dsh-base 提供 settings/credentials 服务）：

| 产物 | 位置 |
| --- | --- |
| provider profile | `~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.<路由名>`，写入即注册路由 |
| API key | `~/.dsh/.credentials.yaml`（0600），引用名为 `<路由名大写>_API_KEY` |

密钥答案在会话记录中只显示 `••••••`；若进程环境已有同名变量，则跳过写入、
运行时直接从环境解析。配置与 dsh web 端的 Models 设置页互通（同一 settings
section）。裸 `dsh --config cordis.yml` 启动没有这些服务，`/provider` 会提示
不可用。添加完成后运行 `/model` 即可切换到新路由的模型。

## 组合约束

- `user-interaction` 服务通常由 `dsh-base` 提供。本插件会在裸装时兜底创建，
  但 profile patch 不应重复插入。
- 自定义插入 subagent provider 时，核心 `subagent` 服务必须先挂载。
- 自定义覆盖 `plan-mode` 时，`section` 必须是非空文本。
- Profile 使用 base 的 JSONL 持久化并将根目录指向共享的 `~/.dsh/sessions`，
  因而 TUI 和 Web 可以读取同一份会话历史。
- `cordis.yml` 是裸组合示例，服务拓扑可能与 profile patch 不同。正常安装和用户
  覆盖应以 `cordis.patch.yml` 为准。

`DSH_TUI_SESSION_ROOT` 始终表示 JSONL 根目录。`dsh --profile dsh-tui` 默认使用
`$DSH_HOME/sessions`（通常为 `~/.dsh/sessions/`）；直接运行
`dsh --config cordis.yml` 的裸示例默认使用 `~/.dsh-tui/sessions/`。

权限相关配置与平台差异见[架构与限制](architecture.md#权限与安全边界)。
