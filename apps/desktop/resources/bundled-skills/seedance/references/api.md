# Seedance（火山引擎方舟）视频生成 API 参考

整理自火山引擎官方文档（入口：https://www.volcengine.com/docs/82379 → API 参考 → 视频生成 API）。
官方页为前端渲染，若细节有出入以官方文档为准。国际版（BytePlus）同构，端点不同。

## 概览

异步任务模型：**创建任务 → 轮询任务 → 取 video_url 下载**。

| 操作 | 方法 & 路径 |
| --- | --- |
| 创建视频生成任务 | `POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks` |
| 查询单个任务 | `GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}` |
| 查询任务列表 | `GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks` |
| 取消/删除任务 | `DELETE https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}` |

所有请求头：

```
Authorization: Bearer <方舟 API Key>
Content-Type: application/json
```

API Key 在 [火山引擎控制台 · 方舟](https://console.volcengine.com/ark) →「API Key 管理」创建。Seedance 按生成视频条数计费（与分辨率、时长相关），与聊天模型的 key 体系独立。

## 模型（model 字段）

| model ID | 定位 | 分辨率 | 时长 |
| --- | --- | --- | --- |
| `doubao-seedance-1-0-pro-250528` | 旗舰，成片用 | 480p / 720p / 1080p | 5 / 10 秒 |
| `doubao-seedance-1-0-lite-250428` | 快、便宜，试稿用 | 480p / 720p | 5 / 10 秒 |

账号开通了更新的 Seedance 版本（2.x 等）时，用控制台「在线推理」里显示的 model ID 替换即可，接口不变。

## 创建任务

### 请求体

```json
{
  "model": "doubao-seedance-1-0-pro-250528",
  "content": [
    {
      "type": "text",
      "text": "--resolution 1080p --duration 5 --ratio 16:9 --watermark false --seed 42 一只柯基犬戴着墨镜在海滩奔跑，夕阳逆光，电影感，慢镜头"
    }
  ]
}
```

- `model`（必填）：见上表。
- `content`（必填）：内容项数组。
  - 文本项 `{ "type": "text", "text": "…" }`：生成参数用命令行风格前缀写在提示词前面，其余部分是自然语言提示词（中文友好）。
  - 图片项（图生视频）：`{ "type": "image_url", "image_url": { "url": "…" }, "role": "first_frame" }`，`url` 支持公网 https 直链或 `data:image/jpeg;base64,…`。本地文件转 data URL：bash `base64 -w0 first.jpg`；PowerShell `[Convert]::ToBase64String([IO.File]::AllBytes('first.jpg'))`。

### 文本内的生成参数

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--resolution` | `480p` `720p` `1080p` | `720p` | lite 最高 720p；1080p 仅 pro |
| `--duration` | `5` `10` | `5` | 时长（秒） |
| `--ratio` | `16:9` `9:16` `4:3` `3:4` `1:1` `21:9` `adaptive` | `16:9` | `adaptive` 跟随首帧图画幅（图生视频常用） |
| `--fps` | `24` | `24` | 固定帧率，一般不用传 |
| `--watermark` | `true` `false` | `false` | 结果是否带水印 |
| `--seed` | 整数 | 随机 | 同 seed + 同参数可复现结果 |
| `--camerafixed` | `true` `false` | `false` | 固定镜头（不做运镜） |

### 提示词写法

按「主体 → 动作 → 场景 → 镜头语言 → 光线 → 风格」组织。例：「城市夜景霓虹街头，一个穿风衣的行人走过斑马线，镜头低角度缓慢跟随，雨后地面反光，赛博朋克风格，浅景深」。

### 响应

```json
{
  "id": "任务ID",
  "model": "doubao-seedance-1-0-pro-250528",
  "status": "queued",
  "content": null,
  "created_at": 1730000000,
  "updated_at": 1730000000
}
```

记下 `id` 用于轮询。

## 轮询任务

`GET …/tasks/{id}`（同鉴权头）。

```json
{
  "id": "任务ID",
  "model": "doubao-seedance-1-0-pro-250528",
  "status": "succeeded",
  "content": { "video_url": "https://…/xxx.mp4" },
  "usage": { "completion_tokens": 0, "prompt_tokens": 0, "total_tokens": 0 },
  "error": null,
  "created_at": 1730000000,
  "updated_at": 1730000600
}
```

- `status`：`queued` → `running` → `succeeded` | `failed` | `cancelled`。建议 10 秒间隔轮询，整体别超过 15 分钟。
- `succeeded`：取 `content.video_url`。**链接 24 小时后失效，拿到立即下载**。
- `failed` / `cancelled`：看 `error.code`、`error.message`。

## 错误对照

| 现象 | 原因 / 处理 |
| --- | --- |
| HTTP 401 | key 无效、未开通方舟或未开通该模型 → 用户检查控制台 |
| HTTP 404 | model ID 写错或该账号未开通此模型 |
| HTTP 400 `InvalidParameter` | resolution / ratio / duration 组合不合法（如 lite 传 1080p） |
| HTTP 429 | 触发限流 → 等 30 秒再试 |
| 任务 `failed` + 内容审核类错误 | 提示词含敏感内容 → 让用户改写 |

## 计费提示

按成功生成的视频条数计费，价格随分辨率和时长档位不同（lite < pro；1080p > 720p）。批量生成前先用 lite 试稿，确认构图和提示词后再用 pro 出成片。

## 国际版（BytePlus）

端点换为 `https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`，model 前缀换 `byteplus-seedance-*`，其余同构。
