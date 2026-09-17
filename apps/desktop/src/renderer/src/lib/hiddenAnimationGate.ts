/**
 * hiddenAnimationGate —— 窗口隐藏时冻结常驻循环动画（对齐 Cindy 同名机制，
 * 实测隐藏期样式重算 -81%）。渲染层自管：visibilitychange 双向切换
 * html[data-app-hidden]，CSS 侧对登记的 infinite 动画类置
 * animation-play-state: paused（而非 none，恢复时从暂停处续播不闪跳）。
 * 新增常驻循环动画必须同步登记进 globals.css 的暂停清单。
 */

export function installHiddenAnimationGate(): void {
  const root = document.documentElement;
  const sync = (): void => {
    if (document.visibilityState === 'hidden') root.dataset.appHidden = 'true';
    else delete root.dataset.appHidden;
  };
  sync();
  document.addEventListener('visibilitychange', sync);
}
