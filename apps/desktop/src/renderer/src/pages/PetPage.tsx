/**
 * PetPage —— 桌宠窗口页面（#/pet 路由）。
 *
 * 状态机（M1）：working（任一会话运行中）> attention（权限审批等待）>
 * sleep（60s 无活动，双图交替呼吸）> idle（默认待机浮动）。
 * 交互：按住拖拽（IPC setBounds，主进程钳制屏幕内）；单击（未拖动）跳转主窗口。
 */
import { useEffect, useRef, useState } from 'react';
import { useRunningIds } from '../stores/sessionStore';
import idleUrl from '../assets/pet/idle.png';
import workingUrl from '../assets/pet/working.png';
import attentionUrl from '../assets/pet/attention.png';
import happyUrl from '../assets/pet/happy.png';
import sleepUrl from '../assets/pet/sleep.png';
import sleepBUrl from '../assets/pet/sleep-b.png';

type PetState = 'idle' | 'working' | 'attention' | 'sleep';

const SLEEP_AFTER_MS = 60_000;

export function PetPage(): React.JSX.Element {
  const runningIds = useRunningIds();
  const [attention, setAttention] = useState(false);
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [sleepAlt, setSleepAlt] = useState(false);
  const dragState = useRef({ dragging: false, moved: false, offsetX: 0, offsetY: 0 });

  // 有活动（运行/审批）就刷新活跃时间
  useEffect(() => {
    setLastActivityAt(Date.now());
  }, [runningIds, attention]);

  // 1s 心跳驱动睡眠判定与双图交替
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setSleepAlt((v) => !v);
    }, 1200);
    return () => clearInterval(t);
  }, []);

  // 权限审批等待 → attention
  useEffect(() => {
    const offReq = window.fundet.onInteractionRequest(() => setAttention(true));
    const offDis = window.fundet.onInteractionDismissed(() => setAttention(false));
    return () => {
      offReq();
      offDis();
    };
  }, []);

  const state: PetState =
    attention ? 'attention'
    : runningIds.size > 0 ? 'working'
    : now - lastActivityAt > SLEEP_AFTER_MS ? 'sleep'
    : 'idle';

  const img =
    state === 'working' ? workingUrl
    : state === 'attention' ? attentionUrl
    : state === 'sleep' ? (sleepAlt ? sleepBUrl : sleepUrl)
    : idleUrl;

  // 拖拽：mousedown 记录窗口左上角与鼠标偏移；move 超 3px 进入拖拽；
  // 用屏幕坐标（e.screenX/Y）直接 setBounds，主进程负责钳制。
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragState.current = { dragging: true, moved: false, offsetX: e.screenX - window.screenX, offsetY: e.screenY - window.screenY };
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragState.current.dragging) return;
      const dx = e.screenX - dragState.current.offsetX;
      const dy = e.screenY - dragState.current.offsetY;
      if (Math.abs(dx - window.screenX) > 3 || Math.abs(dy - window.screenY) > 3) dragState.current.moved = true;
      if (dragState.current.moved) void window.fundet.petSetBounds(dx, dy);
    };
    const onUp = () => {
      if (dragState.current.dragging && !dragState.current.moved) {
        // 单击（未拖动）→ 跳转主窗口
        void window.fundet.petOpenMain();
      }
      dragState.current.dragging = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // 状态对应的程序动效
  const animClass =
    state === 'working' ? 'pet-anim-typing'
    : state === 'idle' ? 'pet-anim-float'
    : state === 'attention' ? 'pet-anim-bounce'
    : state === 'sleep' ? 'pet-anim-breathe'
    : '';

  return (
    <div
      style={{ width: '100%', height: '100%', overflow: 'hidden', userSelect: 'none', WebkitAppRegion: 'drag' } as React.CSSProperties}
      onMouseDown={onMouseDown}
      title="单击打开 LongMa · 按住拖动"
    >
      <img
        src={img}
        alt="pet"
        draggable={false}
        className={animClass}
        style={{ width: 160, height: 160, objectFit: 'contain', pointerEvents: 'none' }}
      />
    </div>
  );
}
