/**
 * RouteFade —— 主区路由切换 220ms 淡入（移植 Cindy FadeSwitcher，F4：仅 opacity）。
 *
 * Cindy 由父组件挂 key={pathname} 控制实例身份；这里组件内用 useLocation 自取
 * pathname 作 key，语义等价：路由变化 → 本组件销毁重挂 → mount effect 从
 * opacity 0 过渡到 1。再次切路由 = 立即打断重挂，无需状态机。
 * transitionend 清 will-change；reduced-motion 直切。
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode, TransitionEvent } from 'react';
import { useLocation } from 'react-router-dom';

export function RouteFade({ children }: { children: ReactNode }): React.JSX.Element {
  const location = useLocation();
  const [opacity, setOpacity] = useState(0);
  const [willChange, setWillChange] = useState<'opacity' | 'auto'>('opacity');

  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    if (reduceMotion) {
      setOpacity(1);
      setWillChange('auto');
      return undefined;
    }
    setOpacity(0);
    setWillChange('opacity');
    // 可见时下一帧切 1，transition 才有 0 起点（同帧批处理不触发过渡）。
    // 窗口隐藏时 rAF 被 Chromium 暂停、transition 冻结在起点（恢复可见后按
    // 文档时间线快进到终态）——50ms timer 兜底保证状态必达 1，杜绝托盘启动
    // （关窗即进托盘是本产品常态）场景下的永久白屏。
    const id = requestAnimationFrame(() => setOpacity(1));
    const fallback = setTimeout(() => setOpacity(1), 50);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(fallback);
    };
  }, [reduceMotion]);

  const handleTransitionEnd = (e: TransitionEvent<HTMLDivElement>): void => {
    if (e.propertyName === 'opacity') setWillChange('auto');
  };

  return (
    <div
      key={location.pathname}
      onTransitionEnd={handleTransitionEnd}
      className="h-full min-h-0 min-w-0 overflow-hidden"
      style={{
        opacity,
        willChange,
        transition: reduceMotion ? 'none' : 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {children}
    </div>
  );
}
