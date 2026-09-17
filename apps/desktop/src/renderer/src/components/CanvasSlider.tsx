/**
 * CanvasSlider —— Canvas 面板开合的宽度过渡（对齐 Cindy RightSidebar 250ms 方案）。
 *
 * - 挂载即 open（恢复态）直接满宽不播动画；只有 open 翻转才走 250ms ease-move。
 * - 关闭不立即卸载：先滑到 0 宽（内容钉 380px 防重排抖动，overflow-hidden 裁切），
 *   280ms 后卸载——与 Cindy「收起期间冻结内容宽快照」同语义。
 * - prevRef 挡住 StrictMode 双跑（第二次 effect prev===open 直接返回）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const CANVAS_W = 380;
const ANIM_MS = 250;

export function CanvasSlider({ open, children }: { open: boolean; children: ReactNode }): React.JSX.Element | null {
  const [mounted, setMounted] = useState(open);
  const [wide, setWide] = useState(open);
  const [animating, setAnimating] = useState(false);
  const prevOpenRef = useRef(open);

  useEffect(() => {
    const prev = prevOpenRef.current;
    prevOpenRef.current = open;
    if (prev === open) return; // 挂载 / StrictMode 二跑 / 无变化：不动画

    if (open) {
      setMounted(true);
      setAnimating(true);
      // 先以 0 宽渲染一帧，下一帧展开，transition 才有起点。窗口遮挡时 rAF 被
      // Chromium 暂停——50ms timer 兜底保证必达（真用户点击时窗口必然可见，
      // 兜底主要服务于无头验证与极端时序）。
      const raf = requestAnimationFrame(() => setWide(true));
      const fallback = setTimeout(() => setWide(true), 50);
      const timer = setTimeout(() => setAnimating(false), ANIM_MS + 30);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(fallback);
        clearTimeout(timer);
      };
    }
    setAnimating(true);
    setWide(false);
    const timer = setTimeout(() => {
      setMounted(false);
      setAnimating(false);
    }, ANIM_MS + 30);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      className="h-full shrink-0 overflow-hidden"
      style={{
        width: wide ? CANVAS_W : 0,
        transition: animating ? `width ${ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none',
      }}
    >
      {/* 动画期间内容钉满宽：外层收到 0 时内容被裁切而不是重排 */}
      <div className="h-full" style={{ width: CANVAS_W }}>
        {children}
      </div>
    </div>
  );
}
