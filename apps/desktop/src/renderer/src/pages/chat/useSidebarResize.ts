import { useCallback, useState } from 'react';

/** 侧栏宽度拖拽（200–400px 夹紧；持久化到 localStorage）。 */
export function useSidebarResize(): { sidebarWidth: number; startSidebarResize: (e: React.PointerEvent) => void } {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('longma.sidebar-width'));
    return saved >= 200 && saved <= 400 ? saved : 260;
  });

  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const move = (ev: PointerEvent): void => {
      const next = Math.min(400, Math.max(200, startW + ev.clientX - startX));
      setSidebarWidth(next);
      localStorage.setItem('longma.sidebar-width', String(next));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [sidebarWidth]);

  return { sidebarWidth, startSidebarResize };
}
