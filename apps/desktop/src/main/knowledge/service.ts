/**
 * 本地知识库服务：库/条目 CRUD、文档索引管线、FTS5 trigram 检索。
 * 纯全文检索形态（无 embedding）——检索质量靠 FTS5 trigram 中文子串匹配 + bm25 排序。
 *
 * FTS 同步：knowledge_chunks_fts 是外部内容表（content=knowledge_chunks, rowid 对齐），
 * 写 chunk 后手动插 FTS、删 chunk 后手动删 FTS（增量维护，全量重建走 rebuildFts）。
 * 索引管线串行执行（模块级 promise 链），个人单机不需要并发。
 */
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { extractDocumentText } from '../doc-text.js';
import { getDb, getSqlite } from '../db/client.js';
import { knowledgeBases, knowledgeChunks, knowledgeItems } from '../db/schema.js';
import { chunkText } from './chunks.ts';
import { buildKnowledgeQuery } from './query.ts';
import { resetInterruptedKnowledgeItems } from './recovery.ts';
import { WebFetchError, fetchPageAsMarkdown } from './web.ts';

export interface KnowledgeBaseView {
  id: string;
  name: string;
  status: string;
  error: string | null;
  fileCount: number;
  chunkCount: number;
  createdAt: number;
}

export interface KnowledgeItemView {
  id: string;
  type: 'file' | 'url';
  baseId: string;
  name: string;
  sourcePath: string;
  status: string;
  error: string | null;
  chunkCount: number;
  createdAt: number;
}

export interface KnowledgeSearchResult {
  baseId: string;
  baseName: string;
  itemName: string;
  seq: number;
  text: string;
  score: number;
}

// ---------- 查询视图 ----------

export function listKnowledgeBases(): KnowledgeBaseView[] {
  // 统计用 GROUP BY 聚合 + JS 合并（关联子查询在 drizzle sql 模板里列限定渲染有坑，实测恒 0）
  const bases = getDb()
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      status: knowledgeBases.status,
      error: knowledgeBases.error,
      createdAt: knowledgeBases.createdAt,
    })
    .from(knowledgeBases)
    .orderBy(asc(knowledgeBases.createdAt))
    .all();
  const stats = getDb()
    .select({
      baseId: knowledgeItems.baseId,
      fileCount: sql<number>`COUNT(*)`,
      chunkCount: sql<number>`COALESCE(SUM(${knowledgeItems.chunkCount}), 0)`,
    })
    .from(knowledgeItems)
    .groupBy(knowledgeItems.baseId)
    .all();
  const statMap = new Map(stats.map((s) => [s.baseId, { fileCount: Number(s.fileCount), chunkCount: Number(s.chunkCount) }]));
  return bases.map((b) => ({
    ...b,
    ...(statMap.get(b.id) ?? { fileCount: 0, chunkCount: 0 }),
  }));
}

export function listKnowledgeItems(baseId: string): KnowledgeItemView[] {
  return getDb()
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.baseId, baseId))
    .orderBy(asc(knowledgeItems.createdAt))
    .all();
}

// ---------- 库 / 条目 CRUD ----------

export function createKnowledgeBase(name: string): KnowledgeBaseView {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('知识库名称不能为空');
  if (trimmed.length > 60) throw new Error('名称过长（最多 60 字）');
  const row = { id: randomUUID(), name: trimmed, status: 'ready', error: null, createdAt: Date.now() };
  getDb().insert(knowledgeBases).values(row).run();
  return { ...row, fileCount: 0, chunkCount: 0 };
}

export function deleteKnowledgeBase(id: string): void {
  const db = getDb();
  const chunkIds = db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).where(eq(knowledgeChunks.baseId, id)).all();
  if (chunkIds.length > 0) deleteFtsRows(chunkIds.map((c) => c.id));
  db.delete(knowledgeChunks).where(eq(knowledgeChunks.baseId, id)).run();
  db.delete(knowledgeItems).where(eq(knowledgeItems.baseId, id)).run();
  db.delete(knowledgeBases).where(eq(knowledgeBases.id, id)).run();
}

export function deleteKnowledgeItem(itemId: string): void {
  const db = getDb();
  const chunkIds = db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).where(eq(knowledgeChunks.itemId, itemId)).all();
  if (chunkIds.length > 0) deleteFtsRows(chunkIds.map((c) => c.id));
  db.delete(knowledgeChunks).where(eq(knowledgeChunks.itemId, itemId)).run();
  db.delete(knowledgeItems).where(eq(knowledgeItems.id, itemId)).run();
}

// ---------- FTS 同步（外部内容表：rowid 对齐 knowledge_chunks.rowid，手动维护） ----------

function insertFtsRows(rows: Array<{ rowid: number; text: string }>): void {
  if (rows.length === 0) return;
  const sqlite = getSqlite();
  const stmt = sqlite.prepare('INSERT INTO knowledge_chunks_fts(rowid, text) VALUES (?, ?)');
  const tx = sqlite.transaction((rs: Array<{ rowid: number; text: string }>) => {
    for (const r of rs) stmt.run(r.rowid, r.text);
  });
  tx(rows);
}

function deleteFtsRows(chunkIds: string[]): void {
  if (chunkIds.length === 0) return;
  const sqlite = getSqlite();
  const placeholders = chunkIds.map(() => '?').join(',');
  const rows = sqlite
    .prepare(`SELECT rowid, text FROM knowledge_chunks WHERE id IN (${placeholders})`)
    .all(...chunkIds) as Array<{ rowid: number; text: string }>;
  const stmt = sqlite.prepare(
    "INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, text) VALUES('delete', ?, ?)",
  );
  const tx = sqlite.transaction((rs: Array<{ rowid: number; text: string }>) => {
    for (const r of rs) stmt.run(r.rowid, r.text);
  });
  tx(rows);
}

/** 全量重建 FTS 索引（自愈用；外部内容表与主表漂移时调用） */
export function rebuildKnowledgeFts(): void {
  getSqlite().prepare(`INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts) VALUES('rebuild')`).run();
}

// ---------- 索引管线（串行队列） ----------

/** 启动恢复：上次退出/崩溃时卡在非终态的条目重置为 failed（UI 重试按钮可自救） */
export function recoverInterruptedKnowledgeJobs(): number {
  return resetInterruptedKnowledgeItems(getDb());
}

let chain: Promise<void> = Promise.resolve();

/** 入队一个索引任务（串行执行；失败落条目 error 不阻断后续） */
export function enqueueIndexItem(itemId: string): void {
  chain = chain
    .then(() => indexItem(itemId))
    .catch((err) => {
      console.warn('[longma:knowledge] 索引任务异常', { itemId, error: String(err) });
    });
}

async function indexItem(itemId: string): Promise<void> {
  const db = getDb();
  const item = db.select().from(knowledgeItems).where(eq(knowledgeItems.id, itemId)).get();
  if (!item) return;
  db.update(knowledgeItems).set({ status: 'reading', error: null }).where(eq(knowledgeItems.id, itemId)).run();
  try {
    // 正文来源：url 条目读 Markdown 快照；文件条目 PDF/Word 走 unpdf/mammoth，其余按文本读
    let text: string;
    if (item.type === 'url') {
      text = fs.readFileSync(snapshotFile(item.baseId, itemId), 'utf-8');
    } else {
      const ext = path.extname(item.sourcePath).toLowerCase();
      if (ext === '.pdf' || ext === '.docx') {
        text = await extractDocumentText(item.sourcePath);
        // extractDocumentText 对失败场景返回中文说明串，识别出来视为失败
        if (text.includes('未提取正文') || text.includes('无法读取正文') || text.includes('另存为')) {
          throw new Error(text);
        }
      } else {
        text = fs.readFileSync(item.sourcePath, 'utf-8');
      }
    }
    db.update(knowledgeItems).set({ status: 'indexing' }).where(eq(knowledgeItems.id, itemId)).run();

    const blocks = chunkText(text);
    // 清旧块（重索引场景）
    const old = db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).where(eq(knowledgeChunks.itemId, itemId)).all();
    if (old.length > 0) deleteFtsRows(old.map((c) => c.id));
    db.delete(knowledgeChunks).where(eq(knowledgeChunks.itemId, itemId)).run();

    const sqlite = getSqlite();
    const insertChunk = sqlite.prepare(
      'INSERT INTO knowledge_chunks(id, base_id, item_id, seq, text) VALUES (?, ?, ?, ?, ?)',
    );
    const insertFts = sqlite.prepare('INSERT INTO knowledge_chunks_fts(rowid, text) VALUES (?, ?)');
    const lastRowId = sqlite.prepare('SELECT rowid AS rid FROM knowledge_chunks WHERE id = ?');
    const tx = sqlite.transaction(() => {
      for (let i = 0; i < blocks.length; i++) {
        const cid = randomUUID();
        insertChunk.run(cid, item.baseId, itemId, i, blocks[i]);
        const row = lastRowId.get(cid) as { rid: number };
        insertFts.run(row.rid, blocks[i]);
      }
      db.update(knowledgeItems).set({ status: 'completed', chunkCount: blocks.length, error: null })
        .where(eq(knowledgeItems.id, itemId)).run();
    });
    tx();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(knowledgeItems).set({ status: 'failed', error: message }).where(eq(knowledgeItems.id, itemId)).run();
  }
}

/** 添加文件条目并入队索引；返回条目视图 */
export function addKnowledgeFiles(baseId: string, filePaths: string[]): KnowledgeItemView[] {
  const base = getDb().select().from(knowledgeBases).where(eq(knowledgeBases.id, baseId)).get();
  if (!base) throw new Error('知识库不存在');
  const out: KnowledgeItemView[] = [];
  for (const p of filePaths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
    const supported = ['.md', '.txt', '.pdf', '.docx'];
    if (!supported.includes(path.extname(abs).toLowerCase())) {
      throw new Error(`暂不支持该格式（支持 md / txt / pdf / docx）: ${path.basename(abs)}`);
    }
    const row = {
      id: randomUUID(),
      type: 'file' as const,
      baseId,
      name: path.basename(abs),
      sourcePath: abs,
      status: 'pending',
      error: null,
      chunkCount: 0,
      createdAt: Date.now(),
    };
    getDb().insert(knowledgeItems).values(row).run();
    enqueueIndexItem(row.id);
    out.push(row);
  }
  return out;
}

/** 网页快照落盘位置（raw 目录按库分文件夹） */
function snapshotFile(baseId: string, itemId: string): string {
  return path.join(app.getPath('userData'), 'knowledge-raw', baseId, `${itemId}.md`);
}

/**
 * 添加网页条目：抓取正文 → Markdown 快照落盘 → 入库并索引。
 * 抓取失败/正文过薄（SPA 空壳）直接抛错给用户，不入库。
 */
export async function addKnowledgeUrl(baseId: string, url: string): Promise<KnowledgeItemView> {
  const base = getDb().select().from(knowledgeBases).where(eq(knowledgeBases.id, baseId)).get();
  if (!base) throw new Error('知识库不存在');
  const { title, markdown } = await fetchPageAsMarkdown(url.trim());
  const id = randomUUID();
  const snapshot = snapshotFile(baseId, id);
  fs.mkdirSync(path.dirname(snapshot), { recursive: true });
  fs.writeFileSync(snapshot, markdown, 'utf-8');
  const name = title.slice(0, 80);
  const row = {
    id,
    type: 'url' as const,
    baseId,
    name,
    sourcePath: url.trim(),
    status: 'pending',
    error: null,
    chunkCount: 0,
    createdAt: Date.now(),
  };
  getDb().insert(knowledgeItems).values(row).run();
  enqueueIndexItem(row.id);
  return { ...row };
}

/** 重新抓取网页（覆盖快照）并重索引；失败标 failed 可再试 */
export function refetchKnowledgeItem(itemId: string): void {
  const item = getDb().select().from(knowledgeItems).where(eq(knowledgeItems.id, itemId)).get();
  if (!item) throw new Error('条目不存在');
  if (item.type !== 'url') throw new Error('仅网页条目支持重新抓取');
  enqueueUrlFetch(item.id, item.sourcePath, item.baseId);
}

/** url 条目的抓取任务：抓最新 → 覆盖快照 → 重索引 */
function enqueueUrlFetch(itemId: string, url: string, baseId: string): void {
  chain = chain
    .then(async () => {
      const db = getDb();
      db.update(knowledgeItems).set({ status: 'reading', error: null }).where(eq(knowledgeItems.id, itemId)).run();
      const { markdown } = await fetchPageAsMarkdown(url);
      const snapshot = snapshotFile(baseId, itemId);
      fs.mkdirSync(path.dirname(snapshot), { recursive: true });
      fs.writeFileSync(snapshot, markdown, 'utf-8');
      enqueueIndexItem(itemId);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[longma:knowledge] 网页抓取失败', { itemId, error: message });
      try {
        getDb()
          .update(knowledgeItems)
          .set({ status: 'failed', error: message })
          .where(eq(knowledgeItems.id, itemId))
          .run();
      } catch {
        /* DB 不可用时忽略 */
      }
    });
}

/** 失败条目重试：重置状态并重新入队索引 */
export function retryKnowledgeItem(itemId: string): void {
  const item = getDb().select().from(knowledgeItems).where(eq(knowledgeItems.id, itemId)).get();
  if (!item) throw new Error('条目不存在');
  if (item.type === 'url') {
    refetchKnowledgeItem(itemId);
    return;
  }
  if (!fs.existsSync(item.sourcePath)) throw new Error('源文件已不存在，请删除该条目后重新添加');
  getDb()
    .update(knowledgeItems)
    .set({ status: 'pending', error: null })
    .where(eq(knowledgeItems.id, itemId))
    .run();
  enqueueIndexItem(itemId);
}

/** 递归收集目录下支持的文档（跳过隐藏目录/node_modules 等，上限 200 个） */
export function scanKnowledgeDirectory(dirPath: string): string[] {
  const root = path.resolve(dirPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('目录不存在');
  const supported = new Set(['.md', '.txt', '.pdf', '.docx']);
  const SKIP = new Set(['node_modules', '.git', '.agents', 'dist', 'out', '.longma-uploads']);
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= 200) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= 200) return;
      if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (supported.has(path.extname(ent.name).toLowerCase())) out.push(full);
    }
  };
  walk(root);
  return out;
}

// ---------- 检索 ----------

/**
 * 检索：FTS5 trigram（bm25 排序）为主 + LIKE 短词兜底。
 * 查询预处理见 query.ts（buildKnowledgeQuery：自然句拆词 + OR 组装——
 * 整句 MATCH 是短语匹配，长句召回恒 0 的老缺陷在 v0.2.19 后修复）。
 */
export function searchKnowledge(query: string, baseId: string | undefined, limit: number): KnowledgeSearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const capped = Math.max(1, Math.min(limit, 20));
  const db = getSqlite();
  const baseFilter = baseId ? 'AND c.base_id = ?' : '';
  const baseNames = new Map(listKnowledgeBases().map((b) => [b.id, b.name]));
  const toResult = (r: { baseId: string; seq: number; text: string; itemName: string; rank: number }): KnowledgeSearchResult => ({
    baseId: r.baseId,
    baseName: baseNames.get(r.baseId) ?? '',
    itemName: r.itemName,
    seq: r.seq,
    text: r.text,
    score: -r.rank,
  });

  // FTS 路：词元 OR 匹配（buildKnowledgeQuery；无有效词元则跳过本路）
  const { ftsExpr, shortTerms: queryShortTerms } = buildKnowledgeQuery(q);
  let ftsRows: Array<{ baseId: string; seq: number; text: string; itemName: string; rank: number }> = [];
  if (ftsExpr) {
    const ftsParams: unknown[] = [ftsExpr];
    if (baseId) ftsParams.push(baseId);
    ftsParams.push(capped);
    ftsRows = db
      .prepare(
        `SELECT c.base_id AS baseId, c.seq AS seq, c.text AS text, i.name AS itemName,
                bm25(knowledge_chunks_fts) AS rank
         FROM knowledge_chunks_fts f
         JOIN knowledge_chunks c ON c.rowid = f.rowid
         JOIN knowledge_items i ON i.id = c.item_id
         WHERE knowledge_chunks_fts MATCH ? ${baseFilter}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...ftsParams) as Array<{ baseId: string; seq: number; text: string; itemName: string; rank: number }>;
  }

  // LIKE 路：短词元（<3 字符，如两字中文词）子串兜底
  const seen = new Set(ftsRows.map((r) => `${r.baseId}:${r.itemName}:${r.seq}`));
  const likeRows: Array<{ baseId: string; seq: number; text: string; itemName: string; rank: number }> = [];
  if (queryShortTerms.length > 0) {
    for (const term of queryShortTerms) {
      if (likeRows.length >= capped) break;
      const likeParams: unknown[] = [`%${term}%`];
      if (baseId) likeParams.push(baseId);
      likeParams.push(capped);
      const rows = db
        .prepare(
          `SELECT c.base_id AS baseId, c.seq AS seq, c.text AS text, i.name AS itemName, 0 AS rank
           FROM knowledge_chunks c
           JOIN knowledge_items i ON i.id = c.item_id
           WHERE c.text LIKE ? ${baseFilter}
           LIMIT ?`,
        )
        .all(...likeParams) as Array<{ baseId: string; seq: number; text: string; itemName: string; rank: number }>;
      for (const r of rows) {
        const key = `${r.baseId}:${r.itemName}:${r.seq}`;
        if (!seen.has(key)) {
          seen.add(key);
          likeRows.push(r);
        }
      }
    }
  }
  return [...ftsRows, ...likeRows].slice(0, capped).map(toResult);
}
