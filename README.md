# LongMa

本地优先的桌面 Agent：会话、技能、模型设置都在本机；模型用你自己的 Key（BYOK），不经过我们的云。

界面和会话交互参考了 [Cindy](https://github.com/makecindy/cindy)（Apache-2.0）。Agent 内核裁自 Cindy 的 Pi 接入层，宿主、数据库、设置页是 LongMa 自己写的。许可与归属见 [NOTICE](./NOTICE)。

---

## 它做什么

| 模块 | 说明 |
| --- | --- |
| 会话 | 多会话、流式输出、思考/工具卡片、中断、权限三档（每次询问 / 自动审批 / 完全放行） |
| 工作目录 | 和 Cindy 一样：输入框旁文件夹 chip，最近目录 +「选择其他文件夹」，先选目录再开聊 |
| 模型 | 一个厂商（一套 Base URL + Key）可挂多个模型；对话里按厂商分组切换 |
| 技能 | 导入 `SKILL.md` 或 zip。聊天输入 `/` 点选，消息以 `/skill:名字` 开头 |

数据在本机 SQLite。Windows 用户数据目录：`%APPDATA%\LongMa\`。

---

## 环境

- Node.js ≥ 22.12
- pnpm 9.x（仓库 `packageManager` 为 9.14.4）
- **Windows 上请用 PowerShell 启动**，不要用 WSL 弹窗口（WSLg + Electron 经常只剩任务栏蓝点）

Pi 运行时不进 Git，需要单独准备（见下）。

---

## 启动（Windows，推荐）

在 **Windows PowerShell**（不要用 Ubuntu 终端）：

```powershell
cd D:\AI\Fundet\fundet
pnpm install
node tools\pi\update.mjs 0.83.0 --platform=win32-x64
# 若 GitHub 超时：按 tools/pi/README.md 手动下载 v0.83.0 的 pi-windows-x64.zip
# 解到 apps\pi-bin\win32-x64\（目录里要有 pi.exe 和 theme\）

pnpm dev:win
```

没有 Visual Studio C++ 工具集时，`better-sqlite3` 会走自带的 Windows 预编译文件，一般不必本地编译。

第一次打开后：

1. **设置 → Providers**：加厂商（名称、API 形态、Base URL、Key），再 **+ 添加模型**（例如 `glm-5.1`、`glm-4v`）。
2. 回到首页，点文件夹 chip 选工作目录（默认为用户主目录）。
3. 点「新建会话」开始聊。

智谱示例：API 选 `openai-completions`，Base URL `https://open.bigmodel.cn/api/paas/v4`，模型填官方 id。

---

## 启动（Linux）

```bash
cd /path/to/fundet
pnpm install
pnpm install:pi          # 或按 tools/pi/README.md 手动下 linux-x64
pnpm dev
```

WSL 里 `pnpm dev` 会提示改用 Windows 启动。原因：WSLg 经常画不出可点的 Electron 窗口。

---

## 日常使用

### 工作目录

和 Cindy 一样，**先选文件夹再开聊**。空白首页和输入框左侧都是文件夹 chip：

- 上面是最近用过的目录
- 底下是「选择其他文件夹」

Agent 只在这个目录里读写文件。草稿会话可在发出第一条消息前改目录。

### 技能

安装包自带 `Video`、`social`、`geo`（网站 GEO 封装 [geo-optimizer-skill](https://github.com/Auriti-Labs/geo-optimizer-skill)）、`web-search`。也可在设置里再导入 `SKILL.md` 或 zip。聊天输入 `/` 点选，消息以 `/skill:名字` 开头。

联网搜索在 **设置 → 搜索** 填写 Tavily / Brave / 博查 / 智谱 Web Search 的 API key（和聊天模型不是同一套配置）。填好后**新开对话**，对助手说「搜一下…」即可。

---

## 要不要 fork Cindy？

**LongMa 本身不要做成 Cindy 的 fork。** 两边产品边界不同：Cindy 有账号、多 Agent、移动端、市场；LongMa 是本地 BYOK 的会话 Agent（技能 + 模型设置）。整仓 fork 再减法，会一直被上游拖着走。

**建议另建一个只读对照仓**，方便以后看 Cindy 的好更新：

1. 在 GitHub fork [makecindy/cindy](https://github.com/makecindy/cindy)（或再镜像到 Gitee）。
2. 本机单独放一份，例如 `D:\AI\Cindy`，**不要和 LongMa 混在一个仓库**。
3. 隔一段时间：

```bash
cd D:\AI\Cindy
git fetch origin
git log --oneline HEAD..origin/main
```

重点看这些目录有没有值得搬的提交：

- `packages/maker-core` → 对照我们的 `packages/agent-core`
- `packages/maker-shared` → `packages/shared`
- `apps/desktop/src/renderer/components/new-chat` → 工作目录 / 模型 chip 交互

有用的提交用 `git show` 读完，**手工移植**到 LongMa，不要 `merge` Cindy 主线。

本地已有一份 Cindy 源码作对照即可；fork 的价值是远程备份和方便 `fetch`，不是合并代码。

---

## 仓库结构

```
fundet/
├── packages/
│   ├── agent-core/     # Pi 接入、会话、记忆（源自 Cindy maker-core）
│   └── shared/         # 纯函数/类型（源自 maker-shared）
├── apps/
│   ├── desktop/        # Electron 主工程
│   │   ├── src/main/   # 宿主、IPC、技能、SQLite
│   │   ├── src/preload/
│   │   └── src/renderer/  # React 19 + Tailwind 4
│   └── pi-bin/         # Pi 运行时（gitignore，需自行下载）
└── tools/              # Pi 下载脚本、E2E
```

数据流：

```
界面 → window.fundet（preload）→ IPC
  → 主进程装配 PiAgent
  → 子进程 pi --mode rpc
  → 事件回流落库并推到界面
```

---

## 打包

在 **Windows PowerShell** 打 Windows 安装包（会生成 NSIS exe）：

```powershell
cd D:\AI\TenCent\fundet-buddy-main
pnpm dist:win
```

产物：`apps/desktop/dist/LongMa-Setup-0.0.1-x64.exe`

macOS 安装镜像（未签名）：

- Apple Silicon：`apps/desktop/dist/LongMa-0.0.1-arm64.dmg`
- Intel：`apps/desktop/dist/LongMa-0.0.1-x64.dmg`

双击打开，把 `LongMa.app` 拖到「应用程序」。**未签名应用在较新 macOS 上会直接报「文件已损坏」**（Gatekeeper 拦截，不是真损坏），在终端执行一次即可：

```bash
sudo xattr -cr /Applications/LongMa.app
```

也可用 zip（同样未签名，需同样的 xattr 处理）：

- `apps/desktop/dist/LongMa-0.0.1-arm64-mac.zip`
- `apps/desktop/dist/LongMa-0.0.1-mac.zip`（x64）

正式 dmg 由 GitHub Actions 产出（Actions → dist-mac → Artifacts），本地产物路径以 `apps/desktop/dist/` 实际文件为准。

---

## 安全

- API Key 只经系统凭据库（Electron safeStorage）落盘，不进 SQLite、不进日志。
- 开发态若在无钥匙串环境（部分 WSL），会降级存储并打日志；**打包版不会降级**。
- 权限审批读不到配置时按「每次询问」，不会静默放行。

---

## 开发验证

```bash
pnpm typecheck
pnpm test:unit
pnpm --filter @fundet/agent-core test
```

---

## 许可

Apache-2.0。含 Cindy 衍生代码，见 [NOTICE](./NOTICE)。
