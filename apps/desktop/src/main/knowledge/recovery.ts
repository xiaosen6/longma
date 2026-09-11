/**
 * 知识库索引中断恢复（纯函数模块，不依赖 electron，便于 node --test 单测）。
 * 索引队列是内存 promise 链（service.ts chain），应用退出/崩溃时在途条目
 * 会永久卡在 pending/reading/indexing——启动时统一重置为 failed，
 * 走既有「失败重试」交互自救。
 */
import { inArray } from 'drizzle-orm';
import type { FundetDb } from '../db/client.ts';
import { knowledgeItems } from '../db/schema.ts';

/** 索引管线可能中断的非终态 */
export const INTERRUPTED_ITEM_STATUSES = ['pending', 'reading', 'indexing'] as const;

export const INTERRUPTED_ITEM_ERROR = '上次索引未完成（应用中途退出），请重试';

/** 把卡在非终态的条目重置为 failed；返回重置条数 */
export function resetInterruptedKnowledgeItems(db: FundetDb): number {
  const result = db
    .update(knowledgeItems)
    .set({ status: 'failed', error: INTERRUPTED_ITEM_ERROR })
    .where(inArray(knowledgeItems.status, [...INTERRUPTED_ITEM_STATUSES]))
    .run();
  return result.changes;
}
