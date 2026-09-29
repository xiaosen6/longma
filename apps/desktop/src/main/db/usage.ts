/**
 * usage_daily 读写：turn 级增量累计 + 近 N 天聚合（用量历史页的数据源）。
 * 粒度到 (day, model)：会话中途换模型会轻微误归属，v1 接受。
 * token 拆分（输入/输出/缓存读/缓存写）自 0005 起积累，此前为 0。
 */
import { sql, desc, gte } from 'drizzle-orm';
import { getDb } from './client.js';
import { usageDaily } from './schema.js';

export function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export interface UsageDelta {
  tokens: number;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** 累加一个 turn 的增量（会话累计值做差后的正增量） */
export function addUsageDelta(model: string, delta: UsageDelta): void {
  if (delta.tokens <= 0 && delta.costUsd <= 0) return;
  getDb()
    .insert(usageDaily)
    .values({
      day: todayKey(),
      model,
      tokens: delta.tokens,
      costUsd: delta.costUsd,
      inputTokens: delta.inputTokens ?? 0,
      outputTokens: delta.outputTokens ?? 0,
      cacheReadTokens: delta.cacheReadTokens ?? 0,
      cacheWriteTokens: delta.cacheWriteTokens ?? 0,
    })
    .onConflictDoUpdate({
      target: [usageDaily.day, usageDaily.model],
      set: {
        tokens: sql`${usageDaily.tokens} + ${delta.tokens}`,
        costUsd: sql`${usageDaily.costUsd} + ${delta.costUsd}`,
        inputTokens: sql`${usageDaily.inputTokens} + ${delta.inputTokens ?? 0}`,
        outputTokens: sql`${usageDaily.outputTokens} + ${delta.outputTokens ?? 0}`,
        cacheReadTokens: sql`${usageDaily.cacheReadTokens} + ${delta.cacheReadTokens ?? 0}`,
        cacheWriteTokens: sql`${usageDaily.cacheWriteTokens} + ${delta.cacheWriteTokens ?? 0}`,
      },
    })
    .run();
}

export interface UsageDayRow {
  day: string;
  model: string;
  tokens: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function getUsageHistory(days: number): UsageDayRow[] {
  // 日期过滤下推到 SQL（原先 limit(2000) 再 JS 过滤，90 天以外也白查）
  const sinceDay = shiftDayKeyLocal(todayKey(), -(days - 1));
  return getDb()
    .select()
    .from(usageDaily)
    .where(gte(usageDaily.day, sinceDay))
    .orderBy(desc(usageDaily.day))
    .limit(2000)
    .all();
}

function shiftDayKeyLocal(dayKey: string, deltaDays: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + deltaDays);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}
