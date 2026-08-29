# LongMa 项目记忆（memory.md）

> 最后更新：2026-08-26。给任何接手的人/AI：先读本文，再读 `README.md`（用户向）。Cindy 源码只读对照，**禁止修改、禁止 fork 进本仓**。
>
> 仓库路径：`/mnt/d/AI/TenCent/fundet-buddy-main`（Windows：`D:\AI\TenCent\fundet-buddy-main`）。
> Cindy 对照：`/mnt/d/AI/Fundet/cindy`（只读）。
> 历史名：仓库/包名仍大量使用 `fundet`（`@fundet/agent-core`、`window.fundet`、`FUNDET_*` IPC）。产品名与窗口标题是 **LongMa（龙马）**。

---

## 0. 30 秒上手

```powershell
# 必须在 Windows PowerShell，不要用 WSL 弹 Electron 窗口
cd D:\AI\TenCent\fundet-buddy-main
pnpm install
pnpm dev:win
```

打包 Windows：`pnpm dist:win` → `apps/desktop/dist/LongMa-Setup-0.0.1-x64.exe`。

WSL 里可以改代码、跑 `pnpm --filter fundet-desktop test` / `typecheck`；**不要**在 WSL 里 `pnpm dist` / `electron-vite build`（缺 `@rollup/rollup-linux-x64-gnu`，pnpm store 在 Windows 盘）。

---

## 1. 产品是什么

**LongMa** = 本地优先桌面 Agent：聊天/Agent + 技能 + BYOK。模型请求走用户自己的 Key，不经过我们的云。

- Electron 37 + electron-vite + React 19 + Tailwind 4。
- Agent 底座只有 **Pi v0.83.0**（`earendil-works/pi`，bun 单二进制，`--mode rpc`）。
- UI 视觉对齐 Cindy **CINDY skin**（米色浅色 + CINDY Dark），品牌是蓝马头 Logo，文案中文。
- **不要做成 Cindy fork。** 不搬：账号/OAuth、Ghost 插件、Office、设备互联、IM、语音、定时任务、Claude Code/Codex harness、SkillHub 市场。

已对齐的产品边界：

| 决策 | 结论 |
| --- | --- |
| 账号 | 无。纯本地 + BYOK |
| 窗口 | Windows `frame: false` + 自绘 `WindowControls`；mac hidden titleBar |
| 设置 Tab | **通用 / 模型供应商 / 搜索 / IM 机器人 / 技能**。MCP Servers **已从 UI 拿掉**。IM 是个人栏（自己填飞书/钉钉/企微凭证，微信扫码），不登录 Cindy 云 |
| 技能名 | 英文（`Video`、`social`、`geo`、`web-search`）；介绍文字中文 |
| 复制 | 必须走 Electron `clipboard` IPC（权限处理器曾拒绝 `navigator.clipboard`） |
| 分享 | 截当前回合卡片为图片进剪贴板，不要「复制消息链接」 |
| Mac 包 | 未签名。WSL 打出的 `.dmg` 是 xorriso ISO/HFS+，**不是**正式 UDIF；真 dmg 需 macOS 或 `macos-latest` CI |
| 渲染进程 | `sandbox: true`（0.1.4 起），preload 必须是 CJS 产物（见 §5 坑表「沙箱 ESM preload」） |
| 浏览器自动化 | 内置能力开关（默认关），非 MCP Servers 用户面；托管 Chrome 持久 profile「LongMa」 |
| 视觉发图 | 对齐 Cindy：预设标注 + 编辑对话框「视觉」勾选，只信库值（推断方案已删）。**坑（0.2.5 修）：编辑对话框 save() 曾把 input/maxTokens 静默丢弃**——勾视觉保存后白勾；回填/保存/扫描三处都要透传字段；pi providers 是每次 startSession 重解析的，改完新会话即生效无需重启 |
| 电脑操作 | 内置能力开关（默认关）；cua-driver 外部二进制，遥测已关、审批跟会话档 |
| 约束 | 保持 `@fundet/*` 与 `window.fundet`；Windows 用 PowerShell 跑 Electron |

---

## 2. 硬约束（改代码前必守）

1. **不修改 Cindy 仓库。** 只读参考 `ChatInput` / Canvas / 插件搜索实现。
2. **不 fork Cindy 进 LongMa。** 值得搬的交互用手写移植。
3. **Windows Electron 用 PowerShell**（`pnpm dev:win` / `pnpm dist:win`）。WSLg 窗口经常只剩任务栏蓝点。
4. 权限 fail-closed。`setPermissionRequestHandler` 只放行 clipboard；不要为了方便改成全放。
5. 链接不许顶替主窗口：`main/index.ts` 的 `will-navigate` + `setWindowOpenHandler` 只放行应用自身页面，http(s) 一律 `shell.openExternal`。
6. 设置不要加回 MCP Servers 用户面（用户明确要求去掉）。
7. 技能：`name` 英文，`description` 中文；改 bundled skill 必须 bump `LONGMA_REVISION`，`ensureBundledSkills` 才会覆盖 `~/.agents/skills`。
8. 渲染进程不要 `node:path`；共享逻辑放 `apps/desktop/src/shared/`（无 Node API）。生产 import 可用 `.ts`（tsconfig `allowImportingTsExtensions`）。
9. 注释短、事实性；不要用注释叙述实现过程。
10. **改完产品事实立刻改 `memory.md`**（设置 Tab、技能清单、搜索/GEO/IM 边界）。本文是下一轮 AI 的真源，过期比缺文档更糟。
11. IM 机器人只做**个人凭证**（飞书/钉钉/企微填开放平台 Key，微信 iLink 扫码）。不要搬 Cindy 官方 Hook / 账号云。入站接到现有 Pi 会话，不要拷 Cindy orchestrator 整棵。

---

## 3. 仓库地图

```
fundet-buddy-main/
├── package.json                 # 根脚本：dev:win / dist:win / typecheck / test:unit
├── pnpm-workspace.yaml
├── NOTICE                       # Cindy Apache-2.0 归属
├── README.md                    # 用户向
├── memory.md                    # 本文件
├── packages/
│   ├── agent-core/              # @fundet/agent-core：PiAgent + Maker + Session + memory
│   ├── browser-runtime/         # @fundet/browser-runtime：vendored 浏览器内核（tsc 编译到 dist，external 运行时依赖）
│   ├── browser-mcp/             # @fundet/browser-mcp：浏览器 MCP 门面（单 browser 工具，bundle 进主进程）
│   └── shared/                  # 纯函数（agent-task / session-title / …）
├── apps/
│   ├── desktop/                 # Electron 主工程（产品几乎全在这）
│   │   ├── src/main/            # 宿主、IPC、DB、技能同步、文件协议
│   │   ├── src/preload/         # window.fundet
│   │   ├── src/renderer/        # React UI
│   │   ├── src/shared/          # 主进程+渲染共享类型/文件分类
│   │   ├── resources/bundled-skills/  # Video / social / geo / web-search
│   │   └── dist/                # 安装包产物
│   └── pi-bin/<platform>-<arch>/  # Pi 运行时（gitignore；缺 theme 则 RPC 即崩）
└── tools/                       # Pi 下载、E2E、Cindy 参照截图
```

数据流：

```
ChatPage / ChatInput
  → window.fundet.sendMessage({ sessionId, text, attachments?, create? })
  → IPC session:send
  → PiAgent session.send(UserMessage)   # 字符串或 content blocks（text/image/file）
  → 子进程 pi --mode rpc
  → translator → AgentEvent 广播 + SQLite messages
  → sessionStore 分发到对应会话切片
```

### 关键文件（动手时按任务跳）

| 任务 | 文件 |
| --- | --- |
| 发消息 / 附件 | `apps/desktop/src/main/ipc/register.ts`、`sessionStore.ts`、`ChatPage.tsx` |
| 拖文件 / 回形针 | `ChatInput.tsx`、`lib/file-drop.ts`、`main/fs-local.ts` |
| Canvas 预览 | `lib/artifacts.ts`、`CanvasPane.tsx`、`shared/file-kind.ts`、`main/file-protocol.ts` |
| IPC 契约 | `src/shared/fundet-api.ts`、`preload/index.ts`、`main/ipc/channels.ts` |
| Pi 装配 | `main/host/pi-host.ts`、`packages/agent-core/src/agents/pi/index.ts` |
| 内置技能同步 | `main/host/skills.ts`、`resources/bundled-skills/*/SKILL.md` + `LONGMA_REVISION` |
| 系统提示 | `main/host/system-prompt.md`（已列全四个技能 + `mcp__search__web_search` + 浏览器工具指引 + Git Bash 指引） |
| 浏览器自动化 | `main/browser/{host,mcp-http,runtime-env}.ts`、`packages/browser-runtime|mcp`、`tools/pack-browser-deps.mjs`（打包闭包打平） |
| 主题 token | `renderer/src/styles/globals.css` |
| 上下文窗口 | `src/shared/context-window.ts`（GLM ≥5.2 → 1M，其它扫描默认 256k；不要用残缺 128k 覆盖更好推断） |
| BYOK key | `main/host/secrets.ts`（Windows 打包走系统凭据；Linux dev 可降级 `plain:`） |

---

## 4. 已完成（按主题，含 2026-08 产品轮）

### 4.1 内核 / 桌面骨架

- agent-core 从 Cindy maker-core 裁成仅 Pi；401 等消息级错误不再被 translator 吞掉。
- Maker + Session + 草稿会话（空草稿不进侧栏；`ensureDraftSession` 复用一个空草稿）。
- 记忆：**产品面已固定关闭**（`pi-host.ts` 里 `memoryEnabled: false`、`makerMemoryEnabled` getter 恒 false；内核仍装配 manager，避免改 agent-core）。`memory_search` / `memory_write` 未暴露给模型。
- MCP：主进程桥仍在（stdio 经 `mcp-bridge.ts`，http 直通）。**设置 UI 已删除 MCP Servers。**
- 权限三档：ask / 自动 / 完全放行；审批超时 10 分钟 deny。
- ~~思考等级 chip~~（2026-08-28 加入当天即撤——产品改口；后端链路保留：SESSION_SET_EFFORT/草稿 create effort 均可用，重加只需恢复 EffortSelector 组件）
- Pi extraDirs 支持（热更新）；subagent 扩展只读（read/grep/find/ls），GEO 走 bash CLI 不靠 subagent。

### 4.2 UI / 交互（Cindy 风格，品牌 LongMa）

- 两栏：Sidebar 260px + 主区；Canvas 右侧 380px。
- 无边框窗口 + `WindowControls`。
- 关闭行为（Win/Linux）：关窗 = 最小化到托盘（进程不退，IM 机器人保持在线）；托盘菜单「打开 LongMa / 退出」，首次最小化弹一次气泡提示。`session-end` 放行系统关机；`requestSingleInstanceLock` 单实例，二次启动唤起已隐藏窗口；无托盘环境（部分 Linux）回退为关窗即退出。macOS 保持系统惯例不动。
- 上下文用量环（Cindy 式 20px）：在 **输入卡下方右侧**，不在顶栏。
- 工作组折叠：「已工作 Xs」。
- 回合结束后操作条：复制、分享（截图）、分叉、更多；**没有**复制消息链接。
- 链接行为：http(s) 一律 `shell.openExternal` 进系统浏览器；本地/相对路径走右侧 Canvas。主进程有 `will-navigate` + `setWindowOpenHandler` 兜底，任何链接都不会再顶替主窗口。
- 死会话容错：模型欠费/401 → pi 死 → Session 被 Maker 回收。此时 set-model / set-effort / set-permission-mode **不抛「会话不在内存」**，只落库，下次发送按新值 lazy-create（create 参数含 effort/permissionMode）。
- 复制：`fundet.copyText` / `copyImageRect`（capturePage）。
- 新对话说明框（无会话且无 activeId）。
- 空草稿不进侧栏。
- 会话重命名：侧栏 hover 铅笔 / 双击标题；顶栏铅笔（hover 显示）/ 双击。Enter 提交、Esc 取消。
- 点击本地图片预览（`LocalImagePreview` + `longma-file://`，失败回退 data URL）。
- 设置：头像/字体/供应商（split pane + 预设向导，无 Cindy OAuth）。
- Canvas 开关钉窗口右上（2026-08-28）：原 toggle 在会话顶栏右簇，Canvas 展开挰窄主列导致按钮左漂 380px；且面板自带的 X 被 WindowControls（138px 宽、z-50 盖顶）压住点不到。改为 fixed 钉在 WindowControls 左侧（right-138px），开/关位置恒定；CanvasPane 自带 X 删除。对齐 Cindy「折叠 toggle 钉窗口层不跟面板跑」。
- 设置「用量历史」页（2026-08-29，对齐 Cindy 同名设置页）：SettingsPage 新 tab（自动操作与搜索之间）；概览 5 格（今日/近30天 token、连续活跃·最长、缓存命中率、用到的模型数）+ 20 周热力图（强度=token）+ 30 天堆叠柱（带 y 轴刻度）+ 按 Agent 表（pi 100%）+ 按模型表（总/占比条/输入/输出/缓存读取/缓存写入/缓存命中率）。数据支撑：agent-core UsageSnapshot 透出 input/output/cacheRead/cacheWrite 累计拆分（translator 账本本来就有）+ migration 0005 给 usage_daily 加四列 + wireSession 做差采集；拆分数据自该版起积累（此前行全 0 → 命中率「—」）。**坑：drizzle 迁移多语句必须 '--> statement-breakpoint' 分隔**，否则 migrate 整条炸。
- 首页折叠仪表盘（2026-08-28，对齐 Cindy HomeUsageDashboard 形态）：usage_daily 表（migration 0004，day×model 主键）+ wireSession 增量采集（同前）+ USAGE_HISTORY IPC；首页空态渲染 **UsageDashboard 可折叠卡**——统计条（今日花费[>2×前7日均值且≥$1 标 warning]/Token 今今日+30天/连续活跃含最长/近30天总额）+ 近 20 周 GitHub 风格热力图（强度=日花费，4 分位桶，color-mix --accent）+ 右栏 30 天每日堆叠柱（按模型分段，无花费日高度回退 token）+ 模型图例；折叠态一行摘要存 localStorage。中途换模型轻微误归属 v1 接受；预算列（本月/月度）BYOK 无来源未放
- Canvas 不再被数据变化强制打开（2026-08-28）：贴附件/新产物只更新 canvasPath，仅用户点击（附件芯片/顶栏按钮）才展开——此前 latestArtifact effect 每回合强制 setCanvasOpen(true)，用户「关不掉」。输入卡下方新增会话短 id（前 8 位）。
- 长会话渲染（2026-08-26）：`AssistantMessage`/`WorkGroupBlock` memo 化（流式 100ms 刷新只重渲染末条；工作组按 children 逐项引用比较）。未做列表虚拟化——超长会话仍卡再上 virtualization。
- 厂商 Logo；模型 context window 扫描（GLM 5.2/5.3 = 1M）。
- 米色 + dark 主题。

### 4.3 拖文件进对话 + Canvas 全类型预览（2026-08-22 已完成并单测）

**文档正文提取（0.1.3 起）**：拖入 PDF/Word 时主进程先把正文抽成纯文本随消息发给模型（`main/doc-text.ts`：unpdf 提 PDF、mammoth 提 docx；200k 字符/30MB 上限；扫描件、老式 .doc、损坏文件各给一句中文说明；失败不阻断发送；多篇文档并行提取，file 块后各跟自己的正文块）。扫描件 PDF 无文字层，要读只能走多模态视觉模型，未做。

**拖入**

- 对话列（含 Canvas）可拖 OS 文件；输入框回形针多选；粘贴图片/文件。
- Electron `webUtils.getPathForFile`；无路径则 `stageBytes`。
- 目录外文件拷到 `{workDir}/.longma-uploads/`（异步 `copyFile`）；已在工作目录内则只引用。
- 发送：`UserMessage` content blocks。图片 ≤8MB 走 `type:image`（Pi 读盘转 base64）；其它（含大图、视频）走 `type:file` 路径引用。
- 文件夹拖入：暂不支持（提示改工作目录或拖文件）。
- 用户气泡显示附件芯片，点击打开 Canvas。

**Canvas**

- `collectArtifacts`：write/edit **以及** 任意 read、用户附件。
- 种类：image / video / audio / html / pdf / markdown / text / other。
- 自定义协议 `longma-file://work/<base64url(workDir)>/<rel>`，相对资源（HTML 的 css）可加载。`protocol.registerSchemesAsPrivileged` 必须在 `app.ready` 前（`main/index.ts` 顶层）。
- HTML iframe 可切「源码」；CSP 已放行 `longma-file:`（img/media/frame）。

**测试**

- `pnpm --filter fundet-desktop test`：54 项（file-kind、file-name、preview-url、fs-local stage、collectArtifacts、search providers、search MCP 协议、doc-text 提取、IM 去重 dedup、IM 回合收口 turn-collector）。
- `pnpm --filter fundet-desktop typecheck` 通过。
- Electron 真机拖拽需 PowerShell `pnpm dev:win`（本环境 WSL 未跑 GUI）。

### 4.4 内置技能

安装后同步到 `~/.agents/skills`（改内容必须升 `LONGMA_REVISION`）。

| name | 作用 |
| --- | --- |
| `Video` | 风格复刻、字幕、剪辑调色（LONGMA_REVISION 4） |
| `social` | sau CLI 发抖音/快手/小红书/B 站/视频号/YouTube（REVISION 4） |
| `geo` | 封装 [geo-optimizer-skill](https://github.com/Auriti-Labs/geo-optimizer-skill) CLI（`python …/run_geo.py` → PATH 上的 `geo`，否则 `uvx --from geo-optimizer-skill geo`）。**不** vendor Python 包。NOTICE：MIT Auriti-Labs。REVISION 3 |
| `web-search` | 公网搜索。调 `mcp__search__web_search`。REVISION 1 |

`system-prompt.md` 已列出上述四个技能。

#### GEO 自己抓站（2026-08-23 产品结论）

**内置 `geo` 完全可以自行抓取用户给出的站点，不需要龙马再做一个网页抓取工具。**

- 助手只拼 CLI：`geo audit --url https://example.com`（以及 `llms` / `schema` / `fix` / sitemap 等）。
- 抓 HTML、`robots.txt`、`llms.txt`、JSON-LD、sitemap **是 CLI 内部的事**，不是龙马 MCP，也不是 bash `curl` 流水线。
- GEO ≠ 通用搜索（那是 `web-search`）；GEO ≠ 打开任意新闻链接读正文。
- **不要**为了 GEO 再内置 crawl 技能，否则会和 CLI 重复抓一遍。
- 本机要有 Python/`uv`，目标 URL 要能从用户电脑访问。CLI 没装、站是强 JS SPA、或要登录时，GEO 会弱或失败——那是环境问题，不是「缺抓取插件」。

**未做（与 GEO 无关）：** 给智能体用的通用读网页能力。搜完读正文现在靠 bash `curl`；SPA/反爬时会翻车。见 §7.1。

### 4.5 IM 个人机器人（2026-08-24）

设置 → **IM 机器人**，借鉴 Cindy 个人栏（不是官方 Cindy Hook）：

| 渠道 | 怎么连 |
| --- | --- |
| 个人微信 | iLink 扫码（协议客户端改编自 Cindy `@cindy/wechat-ilink` / Tencent openclaw-weixin MIT）。`qrcode_img_content` 是 liteapp **HTML 页**不是图片直链，二维码在主进程用 `qrcode` 库本地生成 PNG data URL（CSP 禁止渲染进程加载 weixin.qq.com 图片） |
| 企微智能机器人 | Bot ID + Secret，`@wecom/aibot-node-sdk` |
| 飞书 / Lark | App ID + App Secret，`@larksuiteoapi/node-sdk` 长连 |
| 钉钉 | AppKey + AppSecret，`dingtalk-stream` |

入站文字 → 本机 Pi 会话（`permissionMode: auto`，工作目录默认 `userData/im-workspace`）→ 最终回复打回 IM。群聊飞书/钉钉/企微需要 @。电脑必须开着龙马。没有 Cindy 账号。

健壮性（2026-08-26）：

- **入站去重**（`im/dedup.ts`）：按渠道稳定消息 id（飞书 `message_id`、钉钉 `headers.messageId`、企微 `msgid`、微信 `messageId`），TTL 10min + 容量 2000。长连断线重连重推不再跑两遍回合。
- **单回合兜底超时**（`im/turn-collector.ts`）：10 分钟（agent-core 的 45min turn-stall 看门狗对 IM 太长，一条卡住会堵死该聊天的排队）。超时 abort 会话、回一句提示放行队列；会话拒收时 dispose 释放订阅。

### 4.8 视觉模型发图（2026-08-26 修复轮）

客户报障：火山引擎多模态模型粘贴图片报 `PiImageInputUnsupportedError`。根因两层：

- **模型无 input:image 标记**：PiAgent 发图前校验模型 input 含 'image'（assertImageInputSupported），providers 库的模型从不带该字段 → 一律拒发。修复三层：
  1. ~~按 id 推断视觉家族~~（2026-08-28 改为对齐 Cindy：**只信库值**——providerPresets 预置标注 input、编辑对话框每模型「视觉」勾选；推断模块 model-input.ts 已删除。注意 glm-4.5/5.x 无 V 是纯文本，bigmodel 实测 code 1210。）
  2. 设置 → 模型供应商每模型行「视觉」开关（Eye 图标，写库 input 字段覆盖推断）。
  3. pi-host 映射 input：库值优先、缺省回落推断（存量 DB 免迁移直接生效）。
- **QQ「原图」常是 PNG 套 .jpeg 扩展名**：mime 按扩展名报 image/jpeg、字节是 PNG，严格端点拒收。`file-kind.ts` 加 `sniffImageMime` 魔数嗅探（PNG/JPEG/WebP/GIF），staging 时读头 16 字节纠正。

配套：供应商预设新增「火山方舟（按量，含视觉模型）」（ark /api/v3 + doubao vision 系列，doubao-1.5-vision-pro 带 maxTokens:12288——glm-4v-flash max_tokens 上限 1024 同类坑，wizard 现在透传 maxTokens）；列模型失败报错带实际请求 URL 与 Base URL 形态指引；`shared/friendly-error.ts` 把 1210 content.type/max_tokens 类供应商错误转成中文行动指引（sessionStore error 卡片）。真机端到端已验证：QQ 图 → 嗅探 image/png → glm-4v-flash 真实理解并描述图片。

### 4.9 电脑操作 / Computer Use（2026-08-27，v1）

**形态**：设置 → 通用「电脑操作」开关（默认关）。开启后**新会话**注入 `mcp__computer__*`（cua-driver 0.22.1，trycua/cua 的 Rust 驱动，MIT，**stdio MCP 子进程**，子命令 `mcp`）——57 个工具：截屏/窗口/点击/输入/按键/滚动/AX 树/zoom/录制回放 + driver 自带 browser_*（系统提示引导优先 `mcp__browser__*`，driver 的作后备）。工作流引导：start_session → 观察（list_windows/get_window_state）→ 动作 → 验证。审批不进白名单，跟会话权限三档（建议自动/完全放行会话使用）。

**架构（与 Cindy 不同，v1 透传）**：不搬 Cindy 的 1100 行门面层（代际护栏/路径钳制/progressive 列为二期），直接用龙马现成的 `StdioMcpHttpProxy` 把 driver 挂成 stdio MCP server（每会话一个子进程，dispose 随会话回收）。

**驱动分发**：`tools/cua-driver/update.mjs`（tag 前缀 `cua-driver-rs-v`，asset `cua-driver-rs-<v>-windows-x86_64.zip` 等，GitHub 下载不稳需断点重试），落 `apps/cua-driver-bin/<plat>/`（含 cua-driver-uia.exe/cua_driver_sdk.dll 等伴生文件，缺一不可）；打包经 extraResources → resources/cua-driver/<plat>；CI 两个 workflow 已加下载步。dev 需手动跑一次下载器。

**两个坑**：
- **telemetry disable 子命令与 mcp 子进程争全局锁**：在会话装配路径（哪怕 spawnSync/异步并发）调它会挂死 createSession。只能放在用户开开关的 IPC 里 fire-and-forget，且等它跑完再建会话。
- driver 默认发送无内容遥测——开关开启时自动 `cua-driver telemetry disable`（本地优先）。

**验证**：driver 握手 + 57 工具清单 ✓；dev 真机：computer 开关 → 建会话成功（prepare 含 proxy initialize 预热）、开关还原、IPC 全程活 ✓。未真点鼠标（留给用户体验）。多模态观察（get_window_state vision/som）需要视觉模型。

### 4.6 打包与 CI

- Win：PowerShell `pnpm dist:win` → `LongMa-Setup-<version>-x64.exe`（约 130MB）。`npmRebuild: false`（better-sqlite3 预编译）。
- Mac dmg：`Actions → dist-mac` 手动出包（UDIF 双架构， artifacts 自取）。
- **0.2.6 已发版**（2026-08-30）：系统浏览器登录态开关、错误卡重发按钮、重试提示去重。此前 0.2.5 已发（2026-08-29，视觉勾选保存修复）。
- **0.2.5 已发版**（2026-08-29）：修复视觉勾选保存丢失（编辑对话框 save/回填/扫描三处丢 input/maxTokens）。客户侧升级后：编辑供应商勾「视觉」→保存→新建会话发图即生效。
- **0.2.4 已发版**（2026-08-29）：设置「用量历史」页 + token 四列拆分采集。migration 0005 携带 statement-breakpoint 修复，客户库升级安全。
- **0.2.3 已发版**（2026-08-28）：用量仪表盘完整形态 + 撤思考 chip。EBUSY 预热步不够，release.yml win 打包已改 3 次重试循环（每次清半成品 dist）后全绿。另：本机对 github release 资产 CDN 直连常断，**优先试 gh-proxy.com 镜像**（https://gh-proxy.com/ + 完整 github URL，实测 2.3MB/s 两分钟一个 dmg）；镜像不通再退 api.github.com asset 端点（带 token + Accept: application/octet-stream + curl -C - 续传，~50KB/s 慢速但可拉通）。：思考等级 chip、Canvas 开关钉窗口右上、用量历史卡、（0.2.1 的视觉 Cindy 化/侧栏拖拽等也首次进正式版——0.2.1 与 0.2.2 同日连发）。**发版坑 +1：EBUSY**——electron-builder 拷 fresh 解包的 cua-driver 二进制被 Defender 锁定，CI 连挂两次；workflow 已加「下载后 hash 全量预热」步（aec4bba），tag 必须含该 commit（重跑复用旧 tag commit 不带修复）。
- **0.2.1 已发版**（2026-08-28）：视觉 Cindy 化（预设标注+编辑勾选，推断退役）、Canvas 不强制打开、会话短 id、「自动操作」独立 tab、侧栏拖拽、workDir 中文提示。此前 0.2.0 已发（2026-08-27）：浏览器自动化 + 电脑操作 + 视觉修复 + pi 预检。发版链路三修：vendor js 被 .gitignore 全局 dist/ 误伤没进仓（改 /dist/）；cua-driver zip 解包需整体提升顶层目录（伴生 dll 同目录）；dist:*:publish 脚本必须配 predist 打平钩子（CI 曾漏浏览器闭包）；GitHub Actions 当日事件延迟严重 + 同名 tag 重推会被去重（删 tag 重打）。
- **发版**：推 `v*` tag → `release.yml` 双平台构建并发布 GitHub Release（自动带 latest.yml/latest-mac.yml，应用内更新靠它）。
- **日常 CI**（2026-08-26）：`ci.yml` 在 push main / PR 跑 `pnpm typecheck` + `pnpm test:unit`（ubuntu，`ELECTRON_SKIP_BINARY_DOWNLOAD=1`）。**依赖本地二进制的用例一律 skipIf 缺失即跳**（pi 集成测试、cindyBridgeSource 的 rg 用例——ripgrep-bin 不进 Git，别让 CI 为它下载）。发版 workflow 仍只管构建发布。
- **应用内更新**（0.1.0 起）：设置 → 通用「版本与更新」；Win 后台下载完「重启更新」（托盘退出也会装）；Mac 未签名只检测版本 + 「下载新版本」跳 Release 页。启动 5s 首查 + 每 4h 静默查。dev 态（!isPackaged）不启用。

### 4.7 浏览器自动化（2026-08-26，从 Cindy 移植）

**形态**：设置 → 通用「浏览器自动化」开关（默认关）。开启后**新会话**注入内置 MCP `browser`（localhost streamable-HTTP + Bearer，每会话一份，底层共享 runtime 单例），模型工具 `mcp__browser__browser`（单工具 23 action：tabs/navigate/snapshot/screenshot/act/requests/extract/recipe…）+ `mcp__browser__list_tools`。审批**不进白名单**——跟会话权限三档走（默认 ask 每次问，想免打扰切自动/完全放行）。

**内核**：`packages/browser-runtime` = Cindy browser-control-runtime 整包移植（vendored 上游 openclaw/MIT，lock 在 `upstream/browser-runtime.lock.json`）。playwright-core **connectOverCDP** 连自 spawn 的托管 Chrome：持久 profile「LongMa」（蓝 #2563EB，目录名钉死勿改否则丢登录态）、CDP 18800、**默认有头**（用户能登录，登录态跨会话）、复用用户系统 Chrome 不 playwright install。SSRF 只豁免代理 fake-IP 两段（198.18/15 + IPv6 ULA），localhost/RFC1918/metadata 全拦。56 站点配方内置（L2 用户层未接）。

**宿主**：`main/browser/host.ts`——惰性单例 + usage 跟踪（没用过 quit 时**不发 stop**，stop 本身会拉起服务挂住退出）；`mcp-http.ts` 用 SDK StreamableHTTPServerTransport 挂 HTTP；登录入口 IPC `BROWSER_OPEN` = start+focus 绝不新开 tab。

**打包架构（重要，改打包前先读 §5 对应坑）**：browser-runtime **tsc 编译到 dist/ 作为 external 运行时依赖**（`pnpm --filter @fundet/browser-runtime compile`，desktop prebuild/predev 钩子），其 npm 闭包（101 包：playwright-core/sharp/@img 二进制/express 树…）由 `tools/pack-browser-deps.mjs` 打平成真实文件（`.pnpm` 符号链接去引用），经 electron-builder `extraResources` 落到 **resources/node_modules**（asar 外；Electron 主进程模块解析从 asar 向上走到这里；.node 原生二进制免 asarUnpack）。desktop 的 package.json **不声明**这些运行时依赖（只有 devDeps 供类型/vite 解析）——electron-builder 的 pnpm collector 见到 express 树会死循环。MCP SDK 与 browser-runtime 在 vite main 里显式 `rollupOptions.external`。

**验证**：单测 41（runtime，含 SSRF 契约）+ 91（门面）；真机 `RUN_BROWSER_START_E2E=1` vitest 全链 start→status→stop；dev/preview/打包产物三层 CDP 冒烟全过（托管 Chrome 拉起、强杀零残留）。

---

## 5. 环境与坑

| 坑 | 处理 |
| --- | --- |
| 发版 | 推 `v*` tag（须与 desktop `package.json` version 一致）→ `.github/workflows/release.yml` 出 Win exe + Mac dmg 并发布 Release。手动出包用 `dist-mac.yml` |
| 应用内更新 | electron-updater + GitHub Releases（公开仓免鉴权）。**mac 未签名 electron-updater 拒绝替换安装**，只做版本检测 + 跳 Release 页；Win NSIS 未签名可自动更新 |
| electron-updater ESM 炸 | 它是 CJS 且 `autoUpdater` 挂 getter，ESM 静态命名导出扫不出 → 打包版启动即 SyntaxError（dev 被 vite 互操作掩盖）。必须 `import pkg from 'electron-updater'` 再解构。**发版前必须冒烟跑一遍打包产物**（`dist/win-unpacked/LongMa.exe`），typecheck/dev 绿不代表打包能起 |
| 客户机 rg/grep 全挂 | 打包曾漏打 ripgrep：`extraResources` 必须含 `apps/ripgrep-bin/<plat>`（0.1.2 起已修）。下载器 `tools/ripgrep/update.mjs`（移植自 Cindy，官方 release + sha256），CI 两个 workflow 都有下载步 |
| Windows bash 不可用 | pi 的 bash 工具只认 Git Bash / PATH bash.exe（排除 WSL legacy bash）。客户机没装 Git for Windows → bash 工具废。system-prompt 已让模型引导用户装 Git |
| AUTO_REVIEW_UNAVAILABLE | 龙马没配 AI 审阅器，auto 档 = 确定性本地判定（安全动作自动放、灰色动作问用户）。该英文提示已按「无审阅器不弹」关掉（agent-core pi/index.ts） |
| WSL Electron 窗口蓝点 | `pnpm dev:win` 在 PowerShell |
| WSL vite/rollup 缺 linux native | 构建/打包在 Windows；WSL 只改代码+node:test |
| 剪贴板无反应 | 权限 handler 曾 deny all；只放行 clipboard + IPC writeText/capturePage |
| 扫描全是 128k | `preferScannedContextWindow`：推理值优先于残缺 128k |
| 图片不能点 | LocalImagePreview；现用 `longma-file://` |
| 复制分享无操作 | 同上 clipboard IPC；分享=截图 |
| 空对话进列表 | 隐藏无 items 的草稿 |
| Pi 缺 theme 目录 | RPC 即崩；`apps/pi-bin/<plat>/` 必须是完整解包 |
| GitHub 下 Pi 403 | 按 `tools/pi/README.md` 手动下 v0.83.0 |
| Linux dev safeStorage | password-store=basic；打包版不可用则 set-key 报错 |
| Windows 原生模块 | `npmRebuild: false`，不要本机 node-gyp |
| 技能改了用户目录不更新 | bump `LONGMA_REVISION` |
| 断流重试后 UI 假死 | 主进程 abort 复核/stall 看门狗会把卡死会话 close，但渲染层必须订阅 `agent:status-changed`（`onStatusChanged`）清 `isRunning`，否则停止按钮失效、界面永久转圈。已在 `sessionStore.initGlobalListeners` 挂上 |
| 沙箱渲染进程加载不了 ESM preload | `sandbox: true` 后 `window.fundet` 消失、React 空挂且无报错日志。沙箱只支持 CJS preload：electron.vite.config.ts 显式 `output.format='cjs'` + `entryFileNames:'[name].js'`，`main/index.ts` 的 preload 指 `../preload/index.js`（不再是 .mjs）。沙箱下 preload 可用 API：contextBridge/ipcRenderer/webUtils/process.platform。已 dev 真机验证（CDP 查 window.fundet + IPC 往返）；**下个发版前照例冒烟打包产物** |
| Windows 悬浮 no-drag 挖洞不可靠 | app-region 悬浮层挖洞在 Electron 37/Windows 真机鼠标下失效（hover/点击被 drag 区吞掉，合成输入却正常）。修法：drag 区不与控件重叠——`drag-region` 用 `mr-[150px]` / 内部 absolute 层 `right-[150px]` 在窗口按钮左侧截止（ChatPage 两条头部都是这个结构） |
| **rollup 渲染 vendored browser-runtime 丢代码** | 把 browser-runtime 源码交给 vite bundle，chunk 渲染会在拼接边界**整段丢模块代码**（esbuild "Unterminated string literal"，断点随代码布局漂移；chunk 文件名带未替换占位符 `!~{001}~`）；动态 import 被拆 chunk 时还会反向 import 入口 chunk → 主进程顶层副作用重跑 → **启动/首调即僵死**（CPU 0%，CDP 接受连接永不响应）。Cindy 用 manualChunks 钉单 chunk 规避（其 vite.main.config.ts 有坑记录），electron-vite 4 下钉了照样炸。**根治**：runtime tsc 编译到 dist + external 运行时依赖，vendored 源码永不过 rollup |
| **electron-builder 26 + pnpm collector 遇 express 树死循环** | desktop dependencies 里出现 `@modelcontextprotocol/sdk`（依赖 express@5）后 "searching for node modules" 永久卡死；实测 express@4/@5 单独出现即卡（Cindy 没事是 electron-forge 不做依赖树收集）。**修法**：这批运行时依赖不进 desktop dependencies，`tools/pack-browser-deps.mjs` 打平闭包 → extraResources 到 `resources/node_modules`（asar 外，主进程模块解析向上可及） |
| **pi 在无 AVX2 的 CPU 上启动即崩**（客户报障 code=3221225501） | 0xC000001D 非法指令：pi 是 bun 单二进制，标准 x64 构建要 AVX/AVX2（约 2013 前 Intel / 2015 前 AMD / 部分虚拟机没有；bun 有 baseline 变体但 pi 只发标准构建）。处理：启动预检 `pi --version` 崩溃码探测 → 原生弹窗明示；发送失败经 `friendlyError` 转中文引导。**这类机器暂无解**，除非 earendil-works/pi 出 baseline 构建 |
| sharp 的 @img 平台二进制 | pnpm 对 sharp 的 optionalDependencies（@img/sharp-\<plat\> 等）**不在任何 node_modules 建符号链接**，只落 .pnpm store——dev 里 require('@img/...') 其实也是坏的（仅截图路径触发才发现）。pack 脚本从 store 扫 `@img+sharp-*` 并走闭包；dev 要用截图再处理 |

Pi pin：`tools/pi/latest.json` → **0.83.0**。

用户数据：Windows `%APPDATA%\LongMa\`；DB 现名仍可能是 fundet.db（历史）。

---

## 6. 搜索引擎（调研 2026-08-23；方案 D 已落地）

**现状（已实现）：** 设置 → 搜索，填 Tavily / Brave / 博查 / 智谱 Key；新对话挂 `mcp__search__web_search`。见 §6.6。

下面 6.1–6.5 是选型调研，保留给以后讨论 Exa/DDG。写调研时龙马还没有搜索。

GEO 只审计用户给出的站点（CLI 自抓），不是通用搜索。

### 6.1 行业做法（Agent 产品）

三类，龙马属于 **BYOK 多模型客户端**（和 Cherry / OpenCode 一类，不是 Claude Code）：

1. **模型厂商托管 `web_search`**：Claude Code / Codex / ChatGPT / Gemini / Cindy 默认。搜索在厂商服务器，钱打进模型或订阅。客户端薄壳。  
   - Anthropic：`tools: [{ type: "web_search_20250305", name: "web_search" }]`，约 **$10/千次** + token。底层迹象是 Brave。  
   - **龙马 Pi 当前不会把该 tool 塞进请求**；且多数国产兼容端不实现此 server tool。不能当全员默认。
2. **搜索与聊天模型脱钩**：Cherry 默认 **Exa 公开 MCP**；OpenCode 也接 Exa MCP；可选 Tavily/Brave/智谱 key；早期还有抓百度/必应/DDG HTML。
3. **自托管/抓公开页**：SearXNG、DDG HTML。当兜底，不当头部产品主力。

没人把官方 Google Custom Search 当默认（已停新客，2027-01-01 关停）。没人在桌面 App 里自建全网索引。

### 6.2 Cindy 搜索（对照，勿搬 Ghost）

插件 `cindy-web-search`（不是技能、不是设置 MCP）：

- 模型调 `ghost_call({ ghost_id, tool: "search_web" })`。
- 默认 **Cindy AI**：主机 `POST {网关}/v1/messages`，`model: "cindy/web-search"`，托管 `web_search_20250305`，扣 Cindy 登录额度。
- 可选用户 Brave / Tavily key，主机注入 header，沙箱永不碰明文。失败不跨路。
- 只回 `{title,url,snippet}`。

龙马无账号云、无 Ghost 运行时，**不能抄默认 Cindy AI 路径**，除非自建网关并垫 Anthropic 账单。

### 6.3 Cherry「免费」是什么

不是自建引擎。默认连 **Exa 公司的公开 MCP** `https://mcp.exa.ai/mcp`（`requiresApiKey: false`）。另有模型自带联网、Tavily 等填 key、SearXNG 自建、早期本地抓搜索页。

### 6.4 Exa 公开 MCP 额度（重要，勿对用户承诺「每账号 150」）

- 地址：`https://mcp.exa.ai/mcp`。协议是 MCP，搜索是 Exa 的云索引，**不是谷歌、不是龙马引擎**。
- 不填 key：休闲免费。文档/changelog 出现过约 **3 QPS、每天 150 次**。
- **不是龙马账号配额。** Exa 不认识龙马用户。匿名限速大致按 **出口 IP**。
  - 两家两个公网 IP ≈ 各约 150 次。
  - 同一公司 NAT ≈ **抢同一份** 150。
  - 若将来云上用**一把** Exa key 代搜 ≈ 全产品共用水池。
  - 用户自己填 Exa API key ≈ 才是他自己的积分。
- 超限 429。注册后有每月积分；量大必须带 `x-api-key`。
- 国内访问 `mcp.exa.ai` 可能不稳。

### 6.5 方案清单（给产品选型）

| # | 方案 | 用户要搜索 key？ | 覆盖所有 BYOK？ | 效果 | 建议 |
| --- | --- | --- | --- | --- | --- |
| A | **Exa 公开 MCP** | 否（休闲） | 是 | 开箱较好，英/技术向 | **推荐默认** |
| B | DuckDuckGo HTML（`html.duckduckgo.com`） | 否 | 是 | 一般，中文弱，可被限流 | **推荐兜底** |
| C | DDG Instant Answer API | 否 | 是 | **不是 SERP**，经常空 | 禁止当搜索 |
| D | 可选 Tavily / Brave / 博查 / 智谱 Web Search key | 要（与聊天模型无关） | 配了才有 | 最好 | **推荐设置项** |
| E | 复用当前聊天的 GLM key 调智谱 | 不另买（仅智谱用户） | 否 | 中文好 | 可作快捷勾选，**不当默认门槛** |
| F | Anthropic/OpenAI/Gemini **托管 web_search** | 用聊天 key + 厂商搜索附加费 | 仅支持该 API 的用户 | 最好之一 | 后期加分；需改 Pi |
| G | Cindy 式自建网关 + 垫 Anthropic | 登录我方云 | 登录用户 | 同 Cindy | 改产品形态，第一版不做 |
| H | 我方云 `/search` 代搜（一把智谱/Tavily key） | 登录我方 | 登录用户 | 取决于买哪家 | 有服务器可后期做；全客户共配额 |
| I | 本机/云 SearXNG | 否（要部署） | 是 | 看引擎配置 | 对桌面过重 |
| J | 官方 Google CSE | key | 否 | 一般 | **不可用**（停新客/2027 关） |
| K | 抓 google.com | 否 | 是 | 像谷歌 | **禁止**（违规约、封 IP） |
| L | 自建爬虫索引 | 否 | 是 | — | **禁止**（不是这个产品） |

失败策略（Cindy/业界）：**不静默换路去扣另一家额度。**

搜 ≠ 抓正文 ≠ GEO。搜索只回 snippet；读任意页正文目前 bash `curl`；GEO 由 `geo-optimizer-skill` 自抓目标站。通用 crawl 技能未做，**不是 GEO 的前置依赖**。

### 6.6 已实现（2026-08-23）：方案 D

用户选定 **D：内置 Tavily / Brave / 博查 / 智谱**，接入智能体。**没有**做 Exa MCP 默认或 DDG 兜底。

- 设置新增 Tab **搜索**（`SearchPanel.tsx`）：四家独立 API key，与聊天 Provider 脱钩；默认引擎下拉；测试按钮。
- Key 走 `safeStorage`，id 为 `search-tavily` 等（复用 `writeProviderKey`）。
- 每个新 Pi 会话自动注入内置 MCP `search`（localhost HTTP，Bearer 与 cindy-bridge 同一 token）。
- 模型工具名：**`mcp__search__web_search`**（query / 可选 engine / limit）。
- 内置技能 `web-search`（LONGMA_REVISION 1），`/skill:web-search` 或自然语言「搜一下」。
- `getMcpToolApprovalPolicy`：server `search` **auto-approve**（默认会话是 ask，否则每次搜都弹窗）。其它 MCP 仍 prompt。
- 未配任何 key：工具返回去设置页的说明，不编结果。
- **新开对话**后工具才出现（MCP 在 startSession 注入）。
- 博查：先打 `api.bochaai.com`，非鉴权失败再试旧域 `api.bocha.cn`。

代码：`src/shared/search-engines.ts`、`src/main/search/{config,providers,mcp-server}.ts`、`host/mcp-bridge.ts` 始终注入搜索 MCP。

---

## 7. 待办

### 7.1 下一步

- [x] **搜索方案 D**：Tavily / Brave / 博查 / 智谱，设置填 key，MCP 工具接入 Agent（2026-08-23）。
- [x] `system-prompt.md` 四个技能 + `mcp__search__web_search`。
- [ ] **讨论后再做**：
  - Exa MCP / DDG 免 key 兜底
  - ~~通用网页抓取/crawl~~（2026-08-26 已被浏览器自动化覆盖：`mcp__browser__browser` 的 navigate/snapshot/extract 就是读正文的正规解法，SPA/反爬可用）
  - 模型原生托管 web_search（改 Pi 发送层）
  - 我方云 `/search` 或 Cindy 式网关
  - 已开会话热挂搜索 MCP（现在要新开对话）
  - 搜索/GEO 真机冒烟（WSL 无 Electron GUI；需 PowerShell `pnpm dev:win` + 真 Key / 真 URL）

### 7.2 已知债 / 不阻塞

- [x] `system-prompt.md` 四个技能 + `mcp__search__web_search`（2026-08-23）。
- [ ] 真 key 全链路冒烟（历史 Kimi coding 端点 401）。
- [x] workDir 不存在时提前拦截 + 中文指引（2026-08-28，ensureSession 前 fs 校验）。
- [ ] memory_search / memory_write 未暴露给模型。
- [x] 侧栏会话重命名（hover 铅笔 + 双击；顶栏也可改）。改名不 bump `updatedAt`。
- [x] 上下文圆环放到输入卡下方右侧（对齐 Cindy，不在顶栏）。
- [x] IM 个人机器人：飞书 / 钉钉 / 企微 / 微信扫码（2026-08-24）。电脑要开着；IM 会话默认 auto 权限。
- [x] 侧栏宽度拖拽（2026-08-28：右缘 3px 拖拽条，200–400px 夹紧，localStorage 持久化）。
- [ ] 超长会话列表虚拟化（AssistantMessage/WorkGroupBlock 已 memo 化；仍卡再上 virtualization）。
- [x] 真 Mac UDIF dmg（2026-08-25，GitHub Actions macos-latest，见 §4.6）；WSL dmg 已废弃不用
- [ ] 未签名 Mac 公证（现状：新 macOS 对带 quarantine 的未签名 App 报「文件已损坏」，用户须 `sudo xattr -cr /Applications/LongMa.app`；根治要 Apple 开发者证书 + CI notarize）。
- [ ] 文件夹拖入 composer（Cindy 有 extraDirs；龙马暂拒文件夹）。
- [ ] Canvas 未覆盖的类型仍「用系统打开」。
- [ ] WSL 无法 electron-vite build（rollup linux binding）。

### 7.3 明确不做（除非产品改口）

- Fork Cindy；搬 Ghost/账号/Office。
- Cindy 官方 IM Hook（登录 Cindy 云的共享机器人）。个人飞书/钉钉/企微/微信已做。
- 设置里 MCP Servers 用户面。
- 官方 Google CSE；抓 Google SERP。
- 自建搜索索引。
- 保证 GEO 能让 ChatGPT 引用。

### 7.5 Cindy 移植批次二（2026-08-30，commit 17e1a7d~e376475 后续）

- **使用我的浏览器登录态**（对齐 f1dd63ec 精简版）：main/browser/real-profile.ts——探测系统 Chrome/Edge/Brave（Local State mtime 排序）→ last_used profile → SQLite online-backup（better-sqlite3 backup，源浏览器开着也能一致性拷）→ 改写 Local State 指向 Default（名字标 LongMa）→ staging 原子发布进托管 user-data + 完成标记。开关在设置→自动操作→浏览器自动化内（需先开主开关），**拷贝/清除前强制 stopManagedRuntime**（host 新增，quiesce→stop→resumeAfterStop，vendored runtime 下次 action 按需重启）。关=清登录库恢复空白。Windows Chrome 运行时锁库 → PROFILE_LOCKED 中文提示（设计内）。与 Cindy 差异：他们是独立 Cindy-real 双身份避免清掉手写登录态，龙马 v1 直接覆盖托管 profile（确认弹窗声明），v2 可演进双身份。**未真测成功拷贝路径**（本机 Chrome 开着），实现照 Cindy proven 逻辑。
- **终态错误只弹一次 + 重发按钮**：sessionStore error 事件——终态错误卡每轮只留一张（重复替换文案），瞬时重试提示原地更新不堆叠；错误卡新增「重新发送」按钮（resendLast 重发最后一条用户消息含附件路径）。
- **流式自动跟随（257597b8）**：核对后不移植——他们根因是 window-anchoring 机制（我们没有），我们的贴底实现无同款病灶。
- Cindy 对照仓曾消失（D:/AI/Fundet 不见了，非本会话所为），已用 gh-proxy 镜像 blobless 重克隆回原路径；**ghproxy 也能 git clone**。

### 7.4 调研备查：Cindy 自动操作浏览器 / 电脑操作（2026-08-26，仅调研未实现）

**浏览器自动化**：三层——MCP 门面 `lizi-mcps/src/browser`（单 `browser` 工具 + 23 个 action；截图落盘返路径、结果 JSON 200KB 硬顶）→ host 双后端（外置 Chrome / 侧栏 webview，`apps/desktop/src/main/mcp-integrations/browser.ts`）→ **vendored 内核** `packages/browser-control-runtime`（同步上游 133 文件 + shim，playwright-core **connectOverCDP** 连自 spawn 的托管 Chrome，持久 profile「Cindy」保登录态，默认 headed 让用户能登录；复用用户系统 Chrome 不 playwright install）。安全：SSRF 判定 vendored + 契约测试锁住；导航只限 http(s) 协议、私网放行是产品取舍。Token 阶梯：站点配方（内置 56 站可成长）→ 读 API → extract → scoped snapshot → screenshot。

**电脑操作**：**不自研**——spawn 外部 Rust 二进制 **cua-driver**（github.com/trycua/cua，stdio MCP；macOS TCC 权限归因外包给 CuaDriver.app）；每个 Cindy 会话一个 driver 子进程、换代自愈。门面 `lizi-mcps/src/computer`（约 1100 行、零 Electron 依赖，deps 注入）：`list_tools`/`call_tool` 两工具；定位四模（AX element_index + 窗口本地坐标 + SOM + zoom 放大镜）；**snapshot 代际**防旧 index 打新 UI（STALE_SNAPSHOT）；护栏全在 MCP 层（路径钳制 workingDir、pid 身份验证 fail-closed、replay 预算）；**开关级授权 auto-approve，不逐次弹窗**；品牌化 agent 光标 overlay。零厂商 computer-use API 引用，任何 MCP 模型可用。

**对龙马的启示**：两处都是「两工具 MCP 门面（list_tools/call_tool）+ deps 注入 + host 分离」；龙马的 search MCP 正是同一形态的最小先例。**浏览器自动化已按此移植落地（2026-08-26，见 §4.7）**；电脑操作（cua-driver 路线）仍为讨论项——门面 ~1100 行零 Electron 依赖可移植，外部二进制分发/权限引导是大头（Cindy 写了 ~2000 行），且纯 AX 模式外需要多模态模型。

---

## 8. 命令速查

```powershell
cd D:\AI\TenCent\fundet-buddy-main
pnpm install
pnpm dev:win              # 开发
pnpm dist:win             # NSIS exe
```

```bash
# WSL 可跑
pnpm --filter fundet-desktop test
pnpm --filter fundet-desktop typecheck
pnpm --filter @fundet/agent-core test
```

桌面测试脚本：`apps/desktop/package.json` → `node --test --experimental-strip-types src/shared/*.test.ts src/main/fs-local.test.ts src/main/doc-text.test.ts src/main/search/*.test.ts src/main/im/*.test.ts src/renderer/src/lib/artifacts.test.ts`。

---

## 9. 给接手 AI 的工作方式

1. 先读本节 + §2 硬约束 + 对应「关键文件」表。
2. 搜索相关：实现前再读 §6，不要默认智谱、不要承诺「每龙马账号每天 150 次 Exa」。
3. 视觉：`tools/ref-shots/cindy-*.png` + `globals.css` CINDY token，不要自创色板。
4. UI 改完：Windows 上 `pnpm dev:win` 真机点；WSL 用单测/typecheck。
5. 改 bundled skill：升 `LONGMA_REVISION`。
6. 新 IPC：`channels.ts` + `fundet-api.ts` + `preload` + `register.ts` 四处一起改。
7. 用户附件路径：工作目录外必须 stage 进 `.longma-uploads`，否则 fail-closed 读不了、Canvas 协议 403。
)
