# 本地知识库功能规划（v2 定稿讨论稿，2026-09-10）

> 背景与调研见前版（CherryStudio 源码调研，克隆在 `D:\AI\cherry-studio-research`）。
> **拍板修正（2026-09-10）**：不做 embedding、不做向量化——纯全文检索形态。
> 检索质量靠 FTS5 + 中文 trigram 分词保障。

## 一、定稿形态：纯全文检索知识库

**一句话**：文档进 → 抽正文 → 分块 → FTS5 全文索引 → 模型经内置 MCP 工具检索。
零模型依赖（不需要嵌入服务、不吃额外 BYOK 额度）、零原生扩展、零外部网络调用。

### 检索方案：FTS5 + trigram 分词

- better-sqlite3 捆绑 SQLite 3.53.4，**内置 FTS5 trigram tokenizer**（无需 ICU/原生扩展）。
- trigram 对中文 ≥2 字查询的子串匹配效果好，天然贴合「文件名/公司资料里的词」检索。
- 兜底退路：个人库 chunk 量级（万级内）直接 `LIKE '%词%'` 全扫也就几十 ms——若 trigram 实测有坑可无缝退。
- 排序用 FTS5 内置 bm25()。

### 数据模型（全在主库，migration 0006+）

```sql
knowledge_bases(id, name, status, error, createdAt)
knowledge_items(id, baseId, type='file', name, sourcePath, status, error, chunkCount, createdAt)

knowledge_chunks(id, baseId, itemId, seq, text)                       -- 原文块
knowledge_chunks_fts(text, content='knowledge_chunks')                -- FTS5 trigram 虚表（外部内容模式）
```

- 无嵌入模型/维度/换模型重建语义——库的「身份」只有名字。
- 索引可重建：删 FTS 行重跑分块即恢复。

### 管线

```
选文件 → doc-text.ts 抽正文（PDF/Word 现成；md/txt 直读）
      → 分块：段落聚合 + 滑窗重叠（~500 字，重叠 ~50，中文按句边界切）
      → 写 knowledge_chunks + FTS 虚表
状态机：pending → reading → indexing → completed / failed（内存队列 + 状态表）
```

### Agent 接入（对齐内置 MCP 模式）

- 新会话注入 `mcp__knowledge__search(query, baseId?)`（bm25 topK=8，返回 文件名+块文本+序号）与 `mcp__knowledge__list()`（列库与文件清单）。
- 系统 prompt 增补：「涉及用户文档/资料/公司信息时，先检索知识库再回答」。
- 审批对齐 search：auto-approve（只读本机）。

### UI

设置 → 新 tab「知识库」：
- 库列表（新建/删除）
- 库详情：条目列表（名称/状态/块数）+ 添加文件（复用回形针/拖拽管线）+ 检索测试框（输入词看召回，调参 topK）

## 二、分期

| 期 | 内容 |
| --- | --- |
| **V1** | 上述全部：建库/文件条目/FTS5 trigram 检索/MCP 工具/管理页/检索测试 |
| V1.5 | 失败重试、目录导入、topK 可调、检索高亮 |
| V2 | @知识库点名强制注入（composer 按钮）、引用溯源 UI（[1][2] 角标看原文块）、URL 快照/笔记 |
| 不做 | embedding/向量/rerank（拍板移除）；JobManager 持久队列；多库分组 |

## 三、实现改动面估算（V1）

| 文件 | 改动 |
| --- | --- |
| `main/db/schema.ts` + migration 0006 | 三张表 + FTS 虚表 |
| `main/knowledge/`（新） | 分块器、索引器、检索器、队列（纯函数为主，可单测） |
| `main/knowledge/mcp-server.ts`（新） | 内置 knowledge MCP（照 search/mcp-server.ts 模式） |
| `host/mcp-bridge.ts` | 装配 knowledge server（照 search 同款 ~10 行） |
| `main/ipc/` 四件套 | 库/条目 CRUD + 检索测试 IPC |
| 设置新 tab `KnowledgePanel.tsx`（新） | 管理页 |
| `host/system-prompt.md` | 工具指引一句 |
