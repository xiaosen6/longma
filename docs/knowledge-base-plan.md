# 本地知识库功能规划（v1 讨论稿，2026-09-10）

> 背景：用户需求。Cindy 无此功能；CherryStudio（CherryHQ/cherry-studio）是同类桌面产品里做得最完整的。
> 调研方式：浅克隆 CherryStudio 源码读实现（克隆在 `D:\AI\cherry-studio-research`，含 v2 重构中架构 + `docs/references/knowledge/` 官方架构文档）。

## 一、CherryStudio 怎么做的（调研结论）

**核心链路**：文档解析 → 分块（token 上限+重叠滑窗）→ embedding 向量化 → 存储入库 → 检索（BM25 全文 + 向量余弦，RRF 融合，可选 rerank 重排）→ 注入 prompt。

关键设计点（值得借鉴的）：

1. **存储分层**：业务状态（库/条目/状态机）在主 SQLite；派生检索索引（chunk/FTS/embedding，7 张表）是「可随时重建的投影」——删了重跑索引即可，业务表才是权威。
2. **纯 BM25 库是合法形态**：不配 embedding 模型也能建库用（FTS5 全文检索），之后可「补配」embedding 模型并重索引。这对 BYOK 用户极其友好——没充钱也能先用起来。
3. **检索模式自动定**：有向量模型 → hybrid（BM25+向量，RRF 融合排名）；没有 → 纯 BM25。用户无感。
4. **rerank 可选**：BYOK 接 rerank 模型（如 bge-reranker）则候选重排，没有则 pass-through。
5. **向量检索是暴力余弦**（有候选硬上限）——个人知识库规模（万级 chunk）根本不需要 ANN 索引。
6. **Agent 接入是工具**：模型经 `knowledge_lookup` 工具自主检索（list/search/read/grep/manage）。

**明确不照抄的**：JobManager 持久任务队列、Concept ID 体系、库分组、7 表索引、v2 API Gateway——企业级重架构，LongMa 个人单机用不上。

## 二、LongMa 形态设计

**一句话**：知识库 = 「文档进 → 切块向量化 → 模型经内置 MCP 工具检索」，全面复用现有架构（doc-text 解析、内置 MCP 模式、BYOK provider 体系、better-sqlite3）。

### 架构映射（复用清单）

| 环节 | LongMa 现成能力 |
| --- | --- |
| 文档正文提取 | `main/doc-text.ts`（PDF unpdf / Word mammoth / 200k 字符上限）✅ 直接复用 |
| Agent 接入 | 内置 MCP 模式（search/browser/computer 三个先例：每会话装配 + Bearer + `mcp__<server>__<tool>`）✅ |
| embedding BYOK | provider 体系已有 key 管理（safeStorage）；新增「嵌入模型」配置（OpenAI 兼容 `/embeddings` 端点） |
| 向量存储 | better-sqlite3 主库存 BLOB 向量，**纯 JS 余弦暴力扫**（万级 chunk × 1024 维 ≈ 10ms 级，无需 sqlite-vec 原生扩展——避开原生模块，符合 npmRebuild:false 约束） |
| 全文检索 | better-sqlite3 **内置 FTS5**（BM25），零新依赖 |
| 分块 | 自实现：段落聚合 + 滑窗重叠（~500 token 粗估，重叠 ~50），中文按句切 |
| 状态机 | 简化版：pending → reading → embedding → completed / failed（内存队列 + 状态表，不做持久任务系统） |

### 产品形态

- **入口**：设置 → 新 tab「知识库」（对齐 CherryStudio；也可侧栏入口二期再议）。
- **管理页**：新建库（名字 + 选嵌入模型或「仅全文检索」）→ 拖入/选择文档（复用回形针与拖拽管线）→ 条目列表（名称/状态/块数/错误）→ 检索测试框（输入问题看召回）。
- **会话接入（V1）**：开启知识库后新会话注入 `mcp__knowledge__search(query, baseId?)` / `mcp__knowledge__list()`；系统提示引导「涉及用户文档/资料时先检索」。工具结果带来源（文件名+块序），模型自然引用。
- **审批**：对齐 search——`knowledge` server auto-approve（检索是只读本机操作）。

## 三、数据模型（V1）

```sql
-- 业务权威（主库 migration 0006+）
knowledge_bases(id, name, embedProviderId?, embedModel?, dimensions?, status, error, createdAt)
knowledge_items(id, baseId, type='file', name, sourcePath, status, error, chunkCount, createdAt)

-- 派生索引（可重建；v1 直接放主库，量小）
knowledge_chunks(id, itemId, baseId, seq, text, fts)      -- fts 列进 FTS5 虚表
knowledge_embeddings(chunkId, baseId, vec BLOB)           -- Float32Array 序列化
```

- 嵌入维度建库时锁定：换嵌入模型 = 新建库重新索引（对齐 CherryStudio 语义，避免混维度）。
- 删除文件/库时级联清 chunk/embedding。

## 四、分期

| 期 | 内容 | 依赖 |
| --- | --- | --- |
| **V1 MVP** | 建库（文件型：md/txt/pdf/docx）+ BM25/向量混合检索 + 内置 MCP 工具 + 管理页 + 检索测试 | 全部现成，纯新增 |
| V1.5 | 检索测试调优（topK/阈值）、失败重试、目录导入 | V1 |
| **V2** | @知识库点名注入（composer 按钮，强制 RAG 不走工具）、回答引用溯源 UI（[1][2] 角标点击看原文块）、URL 快照/笔记 | V1.5 |
| V3（可选） | rerank BYOK、Excel/PPT 解析、知识库进 IM 机器人会话 | V2 |

## 五、待拍板决策点

1. **入口位置**：设置 tab「知识库」还是侧栏独立入口（CherryStudio 是侧栏一级）？建议 V1 设置 tab，V2 看使用频率升侧栏。
2. **V1 是否强制要 embedding 模型**：建议按 CherryStudio——无嵌入模型可建「仅全文检索」库，中文 BM25（FTS5 默认分词对中文按字，效果一般）+ 二期考虑简单二元分词提升。
3. **触发方式**：V1 仅模型工具自主检索是否够用？用户明确想「每次都查知识库」的场景等 V2 @点名。
4. **嵌入模型预设**：预设哪些（智谱 embedding-3 / 硅基流动 BAAI/bge-m3 / OpenAI text-embedding-3-small，全 OpenAI 兼容端点）？
