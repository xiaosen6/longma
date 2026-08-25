---
name: web-search
description: 公网搜索。用户说「搜一下」「搜索」「查资料」「最新新闻」「找网页」或 /skill:web-search 时使用。用工具 mcp__search__web_search，不要编造结果。
---

# web-search

你帮用户在公网搜索。对用户说话用中文。

## 怎么搜

调用工具 **`mcp__search__web_search`**：

- `query`（必填）：尽量用用户原话，不要扩写成一长串 SEO 句。
- `engine`（可选）：`tavily` | `brave` | `bocha` | `zhipu`。不传则用设置里的默认引擎。
- `limit`（可选）：1–10，默认 5。

工具由龙马主机调用用户在 **设置 → 搜索** 里配置的 API（Tavily / Brave / 博查 / 智谱），和当前聊天模型不是同一套 key。

## 硬规则

- 只根据工具返回的 `results`（title / url / snippet）回答。没有结果就说没搜到。
- 工具报错「未配置」：请用户打开设置 → 搜索，填写至少一家的 API key，然后**新开对话**再搜（已开的会话不会自动挂上新工具）。
- 不要假装已经搜索。不要编链接。
- 需要正文时：对返回的 URL 用 bash `curl -sL`（或用户工作目录里已有的方式）读取，不要把 snippet 当成全文。
- 一次用户问题先搜 1–2 次；不要连打十几次。

## 引擎怎么选（用户没指定时）

- 中文新闻、国内站点：优先 `bocha` 或 `zhipu`（若已配置）。
- 英文文档、技术资料：`tavily` 或 `brave`。
- 用户点名某家就传对应 `engine`。
