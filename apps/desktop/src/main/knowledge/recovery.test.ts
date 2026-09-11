/**
 * 中断恢复单测：内存 better-sqlite3 + drizzle（不依赖 electron/app）。
 * 契约：pending/reading/indexing → failed + error 说明；completed/failed 不动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { knowledgeBases, knowledgeItems } from '../db/schema.ts';
import {
  INTERRUPTED_ITEM_ERROR,
  resetInterruptedKnowledgeItems,
} from './recovery.ts';

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE knowledge_bases (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready', error TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE knowledge_items (
      id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'file',
      base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      name TEXT NOT NULL, source_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', error TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
  `);
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema: { knowledgeBases, knowledgeItems } });
}

type Db = ReturnType<typeof makeDb>;

function seedItem(db: Db, id: string, status: string, error: string | null = null): void {
  db.insert(knowledgeBases).values({ id: 'base-1', name: '测试库', status: 'ready', createdAt: 1 })
    .onConflictDoNothing().run();
  db.insert(knowledgeItems).values({
    id,
    type: 'file',
    baseId: 'base-1',
    name: `${id}.md`,
    sourcePath: `C:\\tmp\\${id}.md`,
    status,
    error,
    chunkCount: 0,
    createdAt: 1,
  }).run();
}

function itemStatus(db: Db, id: string): { status: string; error: string | null } {
  const row = db.select({ status: knowledgeItems.status, error: knowledgeItems.error })
    .from(knowledgeItems).where(eq(knowledgeItems.id, id)).get();
  assert.ok(row, `条目 ${id} 应存在`);
  return row;
}

test('中断态（pending/reading/indexing）重置为 failed 并带中文说明', () => {
  const db = makeDb();
  seedItem(db, 'a', 'pending');
  seedItem(db, 'b', 'reading');
  seedItem(db, 'c', 'indexing');
  const n = resetInterruptedKnowledgeItems(db);
  assert.equal(n, 3);
  for (const id of ['a', 'b', 'c']) {
    const row = itemStatus(db, id);
    assert.equal(row.status, 'failed');
    assert.equal(row.error, INTERRUPTED_ITEM_ERROR);
  }
});

test('终态（completed/failed）不受影响', () => {
  const db = makeDb();
  seedItem(db, 'ok', 'completed');
  seedItem(db, 'err', 'failed', '原有错误');
  const n = resetInterruptedKnowledgeItems(db);
  assert.equal(n, 0);
  assert.equal(itemStatus(db, 'ok').status, 'completed');
  assert.equal(itemStatus(db, 'err').error, '原有错误');
});

test('混合状态下只重置中断条目', () => {
  const db = makeDb();
  seedItem(db, 'p', 'pending');
  seedItem(db, 'done', 'completed');
  seedItem(db, 'r', 'reading');
  assert.equal(resetInterruptedKnowledgeItems(db), 2);
  assert.equal(itemStatus(db, 'done').status, 'completed');
  assert.equal(itemStatus(db, 'r').status, 'failed');
});

test('空库返回 0（幂等可重复调用）', () => {
  const db = makeDb();
  assert.equal(resetInterruptedKnowledgeItems(db), 0);
  assert.equal(resetInterruptedKnowledgeItems(db), 0);
});
