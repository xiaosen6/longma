/**
 * 侧栏超长标题 hover 跑马灯（移植 Cindy SessionItem 的 SidebarTitleMarquee）。
 *
 * 标题保持原生省略号，只有实际溢出且所在会话行处于 hover 态时才播一次横向滚动。
 * 绑在行上而不是标题上：指针移到右侧操作按钮时跑马灯不能停。
 * 通过 DOM 属性和 CSS 变量驱动（见 globals.css .sidebar-title-marquee*），
 * 避免给高密度侧栏行增加 React 状态订阅。
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface SidebarTitleMarqueeProps {
  children: ReactNode;
  className?: string;
  title: string;
}

export function SidebarTitleMarquee({ children, className, title }: SidebarTitleMarqueeProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const isHoveredRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const stopMarquee = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    delete container.dataset.titleOverflowing;
    container.style.removeProperty('--sidebar-title-marquee-shift');
    container.style.removeProperty('--sidebar-title-marquee-duration');
  }, []);

  const startMarquee = useCallback(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;

    stopMarquee();
    if (track.scrollWidth <= container.clientWidth + 1) return;

    const viewportCount = Math.max(1, Math.ceil(track.scrollWidth / Math.max(container.clientWidth, 1)));
    container.style.setProperty('--sidebar-title-marquee-shift', `${container.clientWidth - track.scrollWidth}px`);
    container.style.setProperty(
      '--sidebar-title-marquee-duration',
      `calc(var(--motion-sidebar-title-marquee-per-viewport) * ${viewportCount})`,
    );
    container.dataset.titleOverflowing = 'true';
  }, [stopMarquee]);

  const stopObserving = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
  }, []);

  const startObserving = useCallback(() => {
    stopObserving();
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (isHoveredRef.current) startMarquee();
    });
    observer.observe(container);
    if (track) observer.observe(track);
    resizeObserverRef.current = observer;
  }, [startMarquee, stopObserving]);

  // 标题变化（重命名）时若仍在 hover 则重测重播
  useLayoutEffect(() => {
    if (isHoveredRef.current) startMarquee();
  }, [startMarquee, title]);

  useEffect(() => {
    const row = containerRef.current?.closest('[data-sidebar-session-row="true"]');
    if (!(row instanceof HTMLElement)) return undefined;

    const onEnter = () => {
      isHoveredRef.current = true;
      startMarquee();
      startObserving();
    };
    const onLeave = () => {
      isHoveredRef.current = false;
      stopObserving();
      stopMarquee();
    };

    row.addEventListener('mouseenter', onEnter);
    row.addEventListener('mouseleave', onLeave);
    if (row.matches(':hover')) onEnter();
    return () => {
      row.removeEventListener('mouseenter', onEnter);
      row.removeEventListener('mouseleave', onLeave);
      onLeave();
    };
  }, [startMarquee, startObserving, stopMarquee, stopObserving]);

  useEffect(() => () => stopObserving(), [stopObserving]);

  return (
    <span ref={containerRef} className="sidebar-title-marquee min-w-0 max-w-full shrink overflow-hidden" title={title}>
      <span className={cn('sidebar-title-marquee__ellipsis', className)}>{children}</span>
      <span ref={trackRef} aria-hidden="true" className={cn('sidebar-title-marquee__track', className)}>
        {children}
      </span>
    </span>
  );
}
