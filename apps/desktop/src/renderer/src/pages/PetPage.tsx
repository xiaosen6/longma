/**
 * PetPage —— 桌宠窗口页面（#/pet 路由）。
 *
 * 序列帧动画：assets/pet/black-heels/<state>-<NN>.png（每状态 6 帧，~140ms/帧）。
 * 状态机（优先级从高到低）：
 *   attention（权限审批等待）> thinking（pi 状态 Thinking）>
 *   working（任一会话运行中）> sleep（60s 无活动，慢速帧+呼吸）> idle（默认）。
 * 交互：按住拖拽（IPC setBounds，主进程钳制屏幕内）；单击（未拖动）跳转主窗口。
 */
import { useEffect, useRef, useState } from 'react';
import { useRunningIds } from '../stores/sessionStore';
import { brand } from '../../../shared/brand.js';

const FRAME_MODULES = import.meta.glob('../assets/pet/black-heels/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 文件名 <state>-<NN>.png → 按帧序排列的 url 表 */
const FRAMES: Record<string, string[]> = (() => {
  const map: Record<string, Array<{ nn: string; url: string }>> = {};
  for (const [file, url] of Object.entries(FRAME_MODULES)) {
    const m = /([a-z]+)-(\d+)\.png$/i.exec(file);
    if (!m) continue;
    (map[m[1].toLowerCase()] ??= []).push({ nn: m[2], url });
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => a.nn.localeCompare(b.nn));
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.map((x) => x.url)]));
})();

const SLEEP_AFTER_MS = 60_000;
const FRAME_MS = 140;

type PetState = 'idle' | 'thinking' | 'working' | 'attention' | 'sleep';

export function PetPage(): React.JSX.Element {
  const runningIds = useRunningIds();
  const [attention, setAttention] = useState(false);
  const [lastStatus, setLastStatus] = useState('');
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [frameIdx, setFrameIdx] = useState(0);
  const dragState = useRef({ dragging: false, moved: false, offsetX: 0, offsetY: 0 });

  // 有活动（运行/审批）就刷新活跃时间
  useEffect(() => {
    setLastActivityAt(Date.now());
  }, [runningIds, attention]);

  // pi 状态文本（Thinking / Working…）驱动 thinking 与 working 区分
  useEffect(() => {
    return window.fundet.onStatusChanged((p) => {
      setLastStatus(String((p as { status?: string }).status ?? ''));
      setLastActivityAt(Date.now());
    });
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

  // 心跳：睡眠判定 + 帧轮换
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setFrameIdx((v) => v + 1);
    }, FRAME_MS);
    return () => clearInterval(t);
  }, []);

  const state: PetState =
    attention ? 'attention'
    : runningIds.size > 0
      ? /think/i.test(lastStatus) ? 'thinking' : 'working'
    : now - lastActivityAt > SLEEP_AFTER_MS ? 'sleep'
    : 'idle';

  const frames = FRAMES[state] ?? FRAMES.idle ?? [];
  const frame = frames.length > 0 ? frames[frameIdx % frames.length] : frames[0];

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

  // 序列帧本身自带动作；只有睡觉叠加一层呼吸缩放
  const animClass = state === 'sleep' ? 'pet-anim-breathe' : '';

  return (
    <div
      style={{ width: '100%', height: '100%', overflow: 'hidden', userSelect: 'none', background: 'transparent' }}
      onMouseDown={onMouseDown}
      title={`单击打开 ${brand.name} · 按住拖动`}
    >
      {frame ? (
        <img
          src={frame}
          alt="pet"
          draggable={false}
          className={animClass}
          style={{ width: 160, height: 160, objectFit: 'contain', pointerEvents: 'none' }}
        />
      ) : null}
    </div>
  );
}
