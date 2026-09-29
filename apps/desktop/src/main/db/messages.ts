/**
 * messages 表读写助手。
 *
 * 落库策略（本阶段从简）：
 * - user 文本：send 时落 {text}
 * - assistant 文本：text 事件 isFinal 时落 {text}
 * - tool_use / tool_result / thinking(final) / done / error：原始 data 以 JSON 落库
 */
import { randomUUID } from 'node:crypto';
import { eq, asc, and, gt, lte, ne } from 'drizzle-orm';
import { getDb } from './client.js';
import { messages } from './schema.js';

export function insertMessage(sessionId: string, role: string, content: unknown): void {
  getDb()
    .insert(messages)
    .values({
      id: randomUUID(),
      sessionId,
      role,
      content: JSON.stringify(content ?? null),
      createdAt: Date.now(),
    })
    .run();
}

/**
 * 区间删除。includeUser=true 时连 user 行一起删（编辑重发/删除本条的语义），
 * 默认 false 保留 user 行（删助手轮的语义——只删中间过程和回复，user 提问保留）。
 */
export function deleteMessagesInRange(
  sessionId: string,
  afterCreatedAt: number,
  untilCreatedAt: number,
  includeUser = false,
): void {
  const conditions = [
    eq(messages.sessionId, sessionId),
    gt(messages.createdAt, afterCreatedAt),
    lte(messages.createdAt, untilCreatedAt),
  ];
  if (!includeUser) conditions.push(ne(messages.role, 'user'));
  getDb().delete(messages).where(and(...conditions)).run();
}

/** 清空会话全部消息（分支切换重写时间线用；与 deleteMessagesInRange 的
 *  「保 user 行」语义不同——这里整棵线性历史作废，由调用方重写）。 */
export function deleteMessagesForSession(sessionId: string): void {
  getDb().delete(messages).where(eq(messages.sessionId, sessionId)).run();
}

export function copyMessagesUntil(fromId: string, toId: string, upToCreatedAt: number): void {
  const rows = listMessages(fromId).filter((m) => m.createdAt <= upToCreatedAt);
  const db = getDb();
  for (const m of rows) {
    db.insert(messages)
      .values({
        id: randomUUID(),
        sessionId: toId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })
      .run();
  }
}

export function listMessages(sessionId: string): Array<typeof messages.$inferSelect> {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))
    .all();
}
