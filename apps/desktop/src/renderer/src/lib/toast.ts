/**
 * 轻量 toast（对齐 Cindy ToastContainer 形态的简化版）：模块级 store +
 * useSyncExternalStore，main.tsx 挂 ToastContainer。FLIP 重排留待有多个并发
 * toast 的实际场景再加（单条出/退场用 float-in/原地淡出）。
 */
import { useSyncExternalStore } from 'react';

export type ToastKind = 'info' | 'error' | 'success';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  /** 自动消失毫秒；0 = 常驻（需手动关） */
  duration: number;
}

const items: ToastItem[] = [];
const listeners = new Set<() => void>();
let seq = 0;

function notify(): void {
  for (const l of listeners) l();
}

export function showToast(text: string, kind: ToastKind = 'info', duration = kind === 'error' ? 6000 : 3200): number {
  const item: ToastItem = { id: ++seq, kind, text, duration };
  items.push(item);
  notify();
  if (duration > 0) {
    setTimeout(() => dismissToast(item.id), duration);
  }
  return item.id;
}

export function dismissToast(id: number): void {
  const idx = items.findIndex((t) => t.id === id);
  if (idx < 0) return;
  items.splice(idx, 1);
  notify();
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
  );
}
