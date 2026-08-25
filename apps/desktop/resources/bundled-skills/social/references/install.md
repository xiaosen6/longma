# 技术安装（Work Buddy / 本机）

综合部不看这份。只有 `sau` 跑不起来、或第一次把 Social 装进 Work Buddy 时才用。

## 1. 本机装好 sau

在 `social-auto-upload` 仓库根目录：

```bash
uv venv
uv pip install -e .
cp conf.example.py conf.py
```

国内安装 Chromium：

```bash
PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright" patchright install chromium
```

Windows PowerShell：

```powershell
$env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"; patchright install chromium
```

验证：`sau --help`、`sau douyin --help`。

YouTube 打不开时，在 `conf.py` 设 `YT_PROXY`。

## 2. 填公司账号

```bash
cp skills/social/accounts.example.yaml skills/social/accounts.yaml
```

把 `称呼`、`别名`、`account` 改成公司真实用法。B 站补 `tid`。

`account` 只允许字母数字和连字符，会变成 `cookies/<平台>_<account>.json`。

## 3. 装进 Work Buddy

Work Buddy 兼容 OpenClaw 技能目录。任选一种：

- 把整个 `social` 文件夹复制到 Work Buddy 的 skills 目录（常见为 `~/.workbuddy/skills/social/`），保证里面有 `SKILL.md`
- 或在 Work Buddy 里「导入技能」，打包 `social` 为 zip 上传

装好后对话里应能命中：social、发抖音、发小红书、扫码登录。

这台电脑要能弹出浏览器、综合部能扫码。不要把登录放到无桌面的云端空跑。

## 4. 第一次带综合部走通

1. 「登录品牌抖音」→ 展示二维码 → 对方扫码
2. 「品牌抖音还能用吗」→ 应回答还能用
3. 用测试视频发一条（可定时，避免误发正式内容）

之后综合部日常只需对 Work Buddy 说话，不再进终端。
