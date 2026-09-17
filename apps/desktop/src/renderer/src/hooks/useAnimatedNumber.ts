import { useEffect, useRef, useState } from 'react';

/**
 * 数字平滑滚动（rAF + ease-out 400ms）：token 计数器等持续增长的数值专用。
 * - 首挂直接返回目标值（不播 0→目标的跳入动画）。
 * - 动画中目标再次变化时从当前显示值重锚定，快速连跳无回退感。
 * - 目标回落（如新一轮 turn 计数清零）直接跳变不做倒数动画。
 * - 差值 <2 的微跳直接贴齐，省一次 rAF。
 */
export function useAnimatedNumber(target: number, duration = 400): number {
  const [displayed, setDisplayed] = useState(target);

  // displayed 不进 effect 依赖（否则每次 tick 重跑 effect 变成无限调度），
  // 用 ref 同步让下一次动画读到最新显示值作为起点。
  const displayedRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  displayedRef.current = displayed;

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const from = displayedRef.current;
    if (from === target) return;
    // 回落 = 重置（新一轮 turn 从上轮总量跳回 0），缓动倒数只会读作倒计时
    if (target < from || target - from < 2) {
      setDisplayed(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) * (1 - t);
      setDisplayed(Math.round(from + (target - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, duration]);

  return displayed;
}
