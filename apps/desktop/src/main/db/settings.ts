/**
 * settings 表读写：main 进程侧需要的简单开关持久化（key-value，值为字符串）。
 * renderer-only 的设置（主题、默认工作目录）不走这里，仍走 localStorage。
 */
import { eq } from 'drizzle-orm';
import { getDb } from './client.js';
import { settings } from './schema.js';

export function getSetting(key: string): string | null {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null) {
    getDb().delete(settings).where(eq(settings.key, key)).run();
    return;
  }
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

/** 删行封装（与 setSetting(key, null) 等价，语义更直白） */
export function deleteSetting(key: string): void {
  setSetting(key, null);
}

/** 布尔设置的便捷封装：缺省返回 defaultValue */
export function getBoolSetting(key: string, defaultValue: boolean): boolean {
  const raw = getSetting(key);
  if (raw === null) return defaultValue;
  return raw === '1';
}

export function setBoolSetting(key: string, value: boolean): void {
  setSetting(key, value ? '1' : '0');
}

/** 前缀扫描（中断回合 marker 等小规模枚举用；settings 表量级小，全表过滤可接受） */
export function listSettingKeys(prefix: string): string[] {
  return getDb()
    .select({ key: settings.key })
    .from(settings)
    .all()
    .map((r) => r.key)
    .filter((k) => k.startsWith(prefix));
}
