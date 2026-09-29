---
name: seedance
description: 火山引擎 Seedance（豆包）视频生成：文生视频、图生视频，生成后把指定文案烧录成视频字幕。用户说「视频生成」「生成视频」「AI 视频」「Seedance」「豆包视频」「火山视频」「给我做个视频」或要把文案喷/烧/加成视频字幕时使用本技能。
---

# seedance：火山引擎 Seedance 视频生成 + 烧字幕

调火山引擎方舟（Ark）的 Seedance 模型生成视频，再用 ffmpeg 把用户指定的字幕文案烧进成片。对用户说话用中文。完整 API 参考见本技能 `references/api.md`。

## 0. 首次使用：配 API Key

Seedance 不走聊天模型供应商，需要**火山引擎方舟 API Key**（单独计费）。

1. 检查 `~/.longma/ark-api-key` 是否存在且非空。
2. 不存在 → 请用户去 [火山引擎控制台 · 方舟](https://console.volcengine.com/ark) → 左侧「API Key 管理」→ 创建 API Key，把 key 粘贴给你。
3. 保存（只此一次）：

```bash
mkdir -p ~/.longma
printf '%s' '用户给的KEY' > ~/.longma/ark-api-key
```

4. 之后每次用 `KEY=$(cat ~/.longma/ark-api-key)` 读取。

**硬规则**：不要把 key 回显到对话里；不要写进工作目录/仓库/任何会被提交的文件；401 报 key 无效时让用户重新提供并覆盖保存。

## 1. 动手前先对参数（生成花钱）

跟用户确认一遍再创建任务：

- **提示词**：中文即可。说清主体、动作、场景、镜头（推/拉/摇/移/固定）、光线、风格。用户只给一句话就帮他扩成镜头描述，扩完念给用户听。
- **模型**：试稿用 `doubao-seedance-1-0-lite-250428`（快、便宜），成片用 `doubao-seedance-1-0-pro-250528`（1080p）。
- **时长** 5 或 10 秒；**分辨率** 480p/720p/1080p；**比例** 16:9 / 9:16（竖屏）/ 1:1 等。
- **图生视频？** 用户给了首帧图（图片路径）就转 base64 传 `first_frame`；参数加 `--ratio adaptive` 跟随图片画幅。
- **字幕文案**：要烧字幕就让用户给逐行文案（每行 ≤15 字最好），或经用户同意由你按视频内容拟。

## 2. 创建任务（curl）

参数用**命令行风格写在 text 里**（官方约定），JSON 先落文件再 POST，避免引号转义错：

```bash
KEY=$(cat ~/.longma/ark-api-key)
cd <工作目录>
cat > seedance-task.json <<'EOF'
{
  "model": "doubao-seedance-1-0-pro-250528",
  "content": [
    {
      "type": "text",
      "text": "--resolution 1080p --duration 5 --ratio 16:9 --watermark false 一只柯基犬戴着墨镜在海滩奔跑，夕阳逆光，电影感，慢镜头，镜头缓慢跟随"
    }
  ]
}
EOF
curl -s -X POST "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d @seedance-task.json
```

返回里的 `id` 记下来。图生视频在 `content` 数组里加一项（本地图先转 data URL）：

```bash
IMG=$(base64 -w0 first.jpg)   # PowerShell: [Convert]::ToBase64String([IO.File]::AllBytes('first.jpg'))
# JSON 里加：
# { "type": "image_url",
#   "image_url": { "url": "data:image/jpeg;base64,$IMG" },
#   "role": "first_frame" }
```

图片也可以用公网 https 直链。完整参数表（--resolution/--duration/--ratio/--watermark/--seed/--camerafixed）见 `references/api.md`。

## 3. 轮询 → 下载

```bash
curl -s "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/<任务ID>" \
  -H "Authorization: Bearer $KEY"
```

- `status`：`queued` → `running` → `succeeded` / `failed` / `cancelled`。每 10 秒查一次，最长等 15 分钟。
- `succeeded` → **立刻**下载（`content.video_url` 只有 24 小时有效）：

```bash
curl -sL -o out.mp4 "<video_url>"
```

- `failed` → 读返回里的 `error.code` / `error.message`，翻译成人话告诉用户（内容审核不过就提示改提示词）。
- 常见 HTTP 错误：401 key 无效或未开通方舟；404 model 不存在或未开通；400 参数组合不合法（检查 resolution/ratio/duration）；429 限流，等 30 秒重试。

## 4. 烧字幕（把指定文案喷进视频）

1. 用户给了逐行文案 → 按视频时长铺时间轴（5 秒 2–3 行、10 秒 4–6 行，均匀分布，自己算好起止时间）。
2. 写 `sub.ass`（样式可控）。`PlayResX/Y` 改成**视频实际分辨率**：

```ass
[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,52,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,2.5,0,2,80,80,90,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.40,0:00:02.80,Default,,0,0,0,,第一句字幕
Dialogue: 0,0:00:03.00,0:00:05.00,Default,,0,0,0,,第二句字幕
```

3. 烧录——**先 cd 到视频所在目录再执行**（相对路径避开 Windows 盘符冒号转义坑）：

```bash
ffmpeg -y -i out.mp4 -vf "ass=sub.ass" out_sub.mp4
```

没有 ffmpeg（`ffmpeg -version` 不通）时：让用户安装，或参考 `Video` 技能的 install.md。
srt 也行（`-vf "subtitles=sub.srt"`），但改样式麻烦，默认用 ass。

4. 竖屏 9:16：`PlayResX/Y` 对调（1080×1920），字号可加大，`MarginV` 调大避开平台底部 UI。
5. 要按视频里**实际语音**对齐时间轴：用 `Video` 技能的本地 Whisper 转写拿时间戳，再把用户文案对上去。

## 5. 自检 + 交付

- `ffprobe` 验时长/分辨率符合下单参数。
- `ffmpeg -ss <中段> -i out_sub.mp4 -frames:v 1 check.png` 抽 2–3 帧，读图确认字幕可见、没溢出、没压脸。
- 交付成片**绝对路径**；视频文件不要往对话里塞。
- 告诉用户：视频链接 24 小时失效但本地文件已保存；重新生成同参数会再计费。

## 硬规则

- key 没配不许编造「已生成」；一切以 API 返回为准。
- 创建任务前必须跟用户对过参数（模型/分辨率/时长/条数），误生成烧的是用户的钱。
- `video_url` 24 小时失效，拿到立刻下载。
- 不要把 key 回显、不要把 key 写进 git 目录。
- 一次生成失败先读 error 讲清原因，不要盲着重试烧钱。
