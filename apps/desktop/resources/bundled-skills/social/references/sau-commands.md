# sau 命令

先能执行 `sau --help`。`sau` 不在 PATH 时依次试：`uv run sau`、仓库 `.venv/Scripts/sau.exe`（Windows）、`.venv/bin/sau`。

`--account` 用对照表里的 `account`，不是「品牌抖音」这种称呼。

登录（浏览器平台建议加 `--headed`）：

```bash
sau <platform> login --account <account> --headed
sau <platform> check --account <account>
```

`platform`：`douyin` | `kuaishou` | `xiaohongshu` | `bilibili` | `tencent` | `youtube`

`check` 打印 `valid` 或 `invalid`。B 站 `login` 不要在非交互环境代跑。

## 视频

公共参数：`--account` `--file` `--title` 必填；`--desc` `--tags`（逗号分隔）`--schedule "YYYY-MM-DD HH:MM"` 可选。不传 `--schedule` 就是立即发。

```bash
sau douyin upload-video --account <account> --file <video> --title "<title>" [--desc "<desc>"] [--tags a,b] [--schedule "YYYY-MM-DD HH:MM"] [--thumbnail <img>] [--thumbnail-landscape <img>] [--thumbnail-portrait <img>] [--product-link <url>] [--product-title "<name>"] [--declaration "<平台选项原文>"]

sau kuaishou upload-video --account <account> --file <video> --title "<title>" [--desc "<desc>"] [--tags a,b] [--schedule "YYYY-MM-DD HH:MM"] [--thumbnail <img>]

sau xiaohongshu upload-video --account <account> --file <video> --title "<title>" [--desc "<desc>"] [--tags a,b] [--schedule "YYYY-MM-DD HH:MM"] [--thumbnail <img>]

sau bilibili upload-video --account <account> --file <video> --title "<title>" --desc "<desc>" --tid <id> [--tags a,b] [--thumbnail <img>] [--schedule "YYYY-MM-DD HH:MM"]

sau tencent upload-video --account <account> --file <video> --title "<title>" [--desc "<desc>"] [--tags a,b] [--schedule "YYYY-MM-DD HH:MM"] [--thumbnail <img>] [--thumbnail-landscape <img>] [--thumbnail-portrait <img>] [--short-title "<short>"] [--category "<cat>"] [--draft]

sau youtube upload-video --account <account> --file <video> --title "<title>" [--desc "<desc>"] [--tags a,b] [--thumbnail <img>] [--playlist "<name>"] [--visibility public|unlisted|private]
```

## 图文

仅抖音、快手、小红书。`--account` `--images` `--title` 必填；`--note` `--tags` `--schedule` 可选。

```bash
sau douyin upload-note --account <account> --images <img1> <img2> --title "<title>" [--note "<note>"] [--tags a,b] [--bgm "<name>"] [--schedule "YYYY-MM-DD HH:MM"] [--notef <txt>]

sau kuaishou upload-note --account <account> --images <img1> <img2> --title "<title>" [--note "<note>"] [--tags a,b] [--schedule "YYYY-MM-DD HH:MM"]

sau xiaohongshu upload-note --account <account> --images <img1> <img2> --title "<title>" [--note "<note>"] [--tags a,b] [--schedule "YYYY-MM-DD HH:MM"]
```

## 平台限制

- 定时必须晚于当前时间至少 2 小时；格式 `YYYY-MM-DD HH:MM`
- 抖音标题超过 30 字会被截断，先让用户改短或确认
- 抖音图文最多 35 张，不要 GIF
- 快手图文不要把同一路径重复多次
- 小红书标签最多 10 个
- B 站 `--desc` 和 `--tid` 必填；`tid` 优先用对照表
- 视频号 `--draft` 只存草稿；图文未接入
- YouTube 无定时；标题不超过 100 字；`--visibility` 默认 `public`
- 用户没提的可选参数不要加
- 默认不要传 `--debug`；登录用 `--headed`，发布沿用 CLI 默认（无头），用户要看窗口再加 `--headed`
