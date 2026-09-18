/**
 * Sidebar —— 会话列表 + 置顶组（手动拖拽序）+ 标题过滤 + 新建会话 + 删除 + 设置入口。
 *
 * 视觉复刻 Cindy 侧栏（真机参照 ref-shots/cindy-02/08，CINDY skin）：
 * - 整块 Surface 平铺，只靠右侧 1px Board 发丝线与主区分隔（无背景色分块、无阴影）。
 * - 顶行品牌位：图形 logo + LongMa 字；其下是同级等权 pill 导航行。
 * - 会话区：「置顶」（settings 持久化有序 id，原生 DnD 重排，拖完落盘）+
 *   「会话」（最近活跃/创建时间，当前会话钉住档位防后台刷新挤走）。
 * - 标签行右侧：搜索切换（标题过滤）+ 排序切换。
 * - 选中行 = 反相胶囊；运行中 = 图标呼吸；需关注 = 光环点；置顶行 hover 有 Pin 钮。
 * - 底部：设置入口做成「用户胶囊」同款。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  CalendarClock,
  CirclePlus,
  MessageSquare,
  Pencil,
  Pin,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SessionListItem } from '../../../shared/fundet-api.js';
import { cn } from '../lib/cn';
import { brand } from '../../../shared/brand.js';
import { getProfile, subscribeProfile } from '../lib/profile';
import { BrandMark } from './BrandMark';
import { SessionRenameInput } from './SessionRenameInput';
import { SidebarTitleMarquee } from './SidebarTitleMarquee';

interface SidebarProps {
  sessions: SessionListItem[];
  activeId: string | null;
  /** 各会话是否有后台 turn 在跑（呼吸点提示） */
  runningIds: ReadonlySet<string>;
  /** 需关注的非活动会话：awaiting=审批悬挂 / error=后台终态错误（切进即读） */
  attentionIds: ReadonlyMap<string, 'awaiting' | 'error'>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  /** 空态常驻说明框：点「新对话」开启，开启后收起 */
  showNewHint?: boolean;
  width?: number;
  /** 拖拽条按下时回调（renderer 侧管理拖拽逻辑） */
  onResizeStart?: (e: React.PointerEvent) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/** 导航行通用样式 —— 各行同款 pill 行（对齐 Cindy SidebarTopNav ROW_CLASS） */
const NAV_ROW_CLASS =
  'flex h-8 w-full items-center gap-2.5 rounded-full px-3 text-14 font-normal text-primary transition-colors hover:bg-hover active:scale-[0.98] select-none cursor-pointer';

const ACTION_BTN =
  'flex h-6 w-6 items-center justify-center rounded-full transition-opacity duration-120 active:scale-[0.98]';

function SessionRow({
  session,
  isActive,
  isRunning,
  attention,
  isPinned,
  draggable,
  onTogglePin,
  onDragStart,
  onDragOverRow,
  onDragEnd,
  onSelect,
  onDelete,
  onRename,
}: {
  session: SessionListItem;
  isActive: boolean;
  isRunning: boolean;
  attention?: 'awaiting' | 'error';
  isPinned?: boolean;
  draggable?: boolean;
  onTogglePin?: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragOverRow?: (id: string) => void;
  onDragEnd?: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const committed = useRef(false);
  const display = session.title || session.model || session.id.slice(0, 8);

  // 运行结束：非活动行底色闪一次 settle 作完成提示（活动会话由状态行直接感知，
  // 且反相胶囊底不参与闪烁）。初次挂载/未跑过不触发。摘类由 onAnimationEnd 驱动：
  // StrictMode 下 effect 双跑，cleanup 会吃掉 setTimeout 而第二次 effect 因
  // wasRunning 已翻转提前 return，定时器方案会让类卡死不摘（Cindy 同款代码没
  // StrictMode 所以无此问题——移植本地化点）。
  const prevRunningRef = useRef(isRunning);
  const [isSettling, setIsSettling] = useState(false);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = isRunning;
    if (isRunning) {
      setIsSettling(false);
      return;
    }
    if (!wasRunning) return;
    setIsSettling(true);
  }, [isRunning]);

  const startEdit = (): void => {
    committed.current = false;
    setDraft(session.title || display);
    setEditing(true);
  };

  const cancel = (): void => {
    committed.current = true;
    setEditing(false);
  };

  const commit = (raw: string): void => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed === session.title) return;
    void onRename(session.id, trimmed);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-sidebar-session-row="true"
      draggable={draggable && !editing}
      onDragStart={() => onDragStart?.(session.id)}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDragOverRow?.(session.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      onClick={() => {
        if (!editing) onSelect(session.id);
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startEdit();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!editing && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(session.id);
        }
      }}
      onAnimationEnd={(e) => {
        if (e.animationName === 'session-settle') setIsSettling(false);
      }}
      className={cn(
        'group relative flex h-8 w-full items-center gap-2.5 rounded-full pr-2 pl-3',
        'text-left text-14 font-medium select-none',
        isActive
          ? 'cursor-pointer bg-accent text-accent-fg'
          : 'cursor-pointer text-primary hover:bg-hover',
        isSettling && !isActive && 'session-settle',
      )}
    >
      <span className="flex w-[15px] shrink-0 items-center justify-center">
        {isRunning ? (
          <MessageSquare
            size={12}
            strokeWidth={1.8}
            className={cn('animate-fundet-pulse', isActive ? 'text-accent-fg' : 'text-warning')}
          />
        ) : attention ? (
          <span
            className="session-attention-dot"
            style={{ background: attention === 'awaiting' ? 'var(--focus)' : 'var(--error-fg)' }}
            title={attention === 'awaiting' ? '等待审批' : '发生错误'}
          />
        ) : (
          <MessageSquare
            size={12}
            strokeWidth={1.8}
            className={isActive ? 'text-accent-fg' : 'text-muted'}
          />
        )}
      </span>

      {editing ? (
        <SessionRenameInput
          value={draft}
          onChange={setDraft}
          onCommit={commit}
          onCancel={cancel}
        />
      ) : (
        <span className="min-w-0 flex-1">
          <SidebarTitleMarquee title={display}>{display}</SidebarTitleMarquee>
        </span>
      )}

      {!editing && (
        <div className="group/slot relative ml-auto flex h-6 min-w-12 shrink-0 items-center justify-end">
          <time
            className={cn(
              'text-12 font-medium tabular-nums transition-opacity duration-120',
              'group-hover:opacity-0 group-focus-within/slot:opacity-0',
              isActive ? 'text-accent-fg opacity-80' : 'text-muted',
            )}
          >
            {formatTime(session.updatedAt)}
          </time>
          <div
            className={cn(
              'absolute top-0 right-0 flex h-6 items-center',
              'transition-opacity duration-120',
              'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
              'group-focus-within/slot:pointer-events-auto group-focus-within/slot:opacity-100',
            )}
          >
            {onTogglePin && (
              <button
                type="button"
                title={isPinned ? '取消置顶' : '置顶'}
                className={cn(
                  ACTION_BTN,
                  isPinned
                    ? isActive
                      ? 'text-accent-fg hover:opacity-70'
                      : 'text-primary hover:opacity-70'
                    : isActive
                      ? 'text-accent-fg hover:opacity-70'
                      : 'text-muted hover:text-primary',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(session.id);
                }}
              >
                <Pin size={13} className={isPinned ? 'fill-current' : ''} />
              </button>
            )}
            <button
              type="button"
              title="重命名"
              className={cn(ACTION_BTN, isActive ? 'text-accent-fg hover:opacity-70' : 'text-muted hover:text-primary')}
              onClick={(e) => {
                e.stopPropagation();
                startEdit();
              }}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              title="删除会话"
              className={cn(ACTION_BTN, isActive ? 'text-accent-fg hover:opacity-70' : 'text-muted hover:text-error')}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(session.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  sessions,
  activeId,
  runningIds,
  attentionIds,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  showNewHint,
  width = 260,
  onResizeStart,
}: SidebarProps): React.JSX.Element {
  const profile = useSyncExternalStore(subscribeProfile, getProfile, getProfile);
  // 置顶（settings 持久化的有序 id；加载失败按无置顶处理）
  const [pinned, setPinned] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  // 搜索：标签行内两态（图标钮 ↔ 输入框），标题/模型/id 前缀过滤
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 排序：active=最近活跃（默认）/ created=创建时间
  const [sortBy, setSortBy] = useState<'active' | 'created'>(() => {
    try {
      return localStorage.getItem('longma.sidebar-sort') === 'created' ? 'created' : 'active';
    } catch {
      return 'active';
    }
  });

  useEffect(() => {
    void window.fundet.getSidebarPinned().then(setPinned).catch(() => setPinned([]));
  }, []);

  const persistPinned = (next: string[]): void => {
    setPinned(next);
    void window.fundet.setSidebarPinned(next).catch(() => {
      /* 落盘失败仅本会话内生效 */
    });
  };

  const togglePin = (id: string): void => {
    persistPinned(pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id]);
  };

  // 置顶行拖拽重排（松手落盘）
  const handleDragOverRow = (overId: string): void => {
    if (!dragId || dragId === overId) return;
    const from = pinned.indexOf(dragId);
    const to = pinned.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = [...pinned];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setPinned(next);
  };
  const handleDragEnd = (): void => {
    if (dragId) persistPinned(pinned);
    setDragId(null);
  };

  // 当前会话钉住（对齐 Cindy #4620 heldPriorityRanks 的简化版）：active 会话锁在
  // 激活时刻的下标档位，后台会话刷新（updatedAt 变化）不把用户正看的行挤走。
  const heldIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeId) {
      heldIndexRef.current = null;
      return;
    }
    const idx = sessions.findIndex((s) => s.id === activeId);
    heldIndexRef.current = idx >= 0 ? idx : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 activeId 变化时捕获档位
  }, [activeId]);

  const sortedSessions = useMemo(() => {
    if (sortBy === 'created') {
      return [...sessions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    }
    const held = heldIndexRef.current;
    if (!activeId || held == null) return sessions;
    const idx = sessions.findIndex((s) => s.id === activeId);
    if (idx <= 0 || idx === held) return sessions;
    const target = sessions[idx];
    const rest = sessions.filter((s) => s.id !== activeId);
    rest.splice(Math.min(held, rest.length), 0, target);
    return rest;
  }, [sessions, sortBy, activeId]);

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const pinnedSessions = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const ordered = pinned.map((id) => byId.get(id)).filter((s): s is SessionListItem => Boolean(s));
    // settings 里没有的新置顶（落盘竞态）按列表序补到尾部
    for (const s of sortedSessions) {
      if (pinnedSet.has(s.id) && !ordered.some((o) => o.id === s.id)) ordered.push(s);
    }
    return ordered;
  }, [pinned, sessions, sortedSessions, pinnedSet]);
  const unpinnedSessions = useMemo(
    () => sortedSessions.filter((s) => !pinnedSet.has(s.id)),
    [sortedSessions, pinnedSet],
  );

  // 搜索过滤：置顶+普通合并平铺
  const q = query.trim().toLowerCase();
  const filterList = (list: SessionListItem[]): SessionListItem[] =>
    q
      ? list.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.model.toLowerCase().includes(q) ||
            s.id.toLowerCase().startsWith(q),
        )
      : list;
  const searching = q.length > 0;

  return (
    <aside
      className="relative z-20 flex h-full shrink-0 flex-col border-r border-board bg-surface"
      style={{ width }}
    >
      <div
        className="absolute top-0 right-0 z-30 h-full w-[3px] cursor-col-resize hover:bg-accent/40"
        onPointerDown={onResizeStart}
      />
      {/* 顶行：图形 logo + 字标 */}
      <div className="drag-region flex h-[46px] shrink-0 items-center gap-2 px-4">
        <BrandMark size={22} />
        <span className="text-15 font-medium tracking-tight text-primary select-none">
          {brand.name}
        </span>
      </div>

      {/* 顶部常驻动作行（对齐 SidebarTopNav：同级等权 pill 行） */}
      <div className="flex flex-col gap-0.5 px-3 pt-1 pb-2.5">
        <div className="group/new relative">
          <button
            type="button"
            onClick={onCreate}
            aria-label="新对话"
            data-sidebar-action="new-chat"
            className={NAV_ROW_CLASS}
          >
            <CirclePlus size={15} strokeWidth={1.8} className="shrink-0 text-muted" />
            <span className="leading-none">新对话</span>
          </button>
          {showNewHint ? (
            <div className="absolute top-1/2 left-full z-30 ml-3 w-[210px] -translate-y-1/2 rounded-container border border-board bg-card px-3 py-2.5 shadow-[var(--shadow-menu)]">
              <div className="absolute top-1/2 left-[-5px] h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-board bg-card" />
              <p className="text-13 font-medium text-primary">开启新对话</p>
              <p className="mt-0.5 text-12 leading-snug text-muted">
                点击后开始。发送第一条消息前不会出现在会话列表。
              </p>
            </div>
          ) : (
            <div className="pointer-events-none absolute top-1/2 left-full z-30 ml-3 hidden w-[210px] -translate-y-1/2 rounded-container border border-board bg-card px-3 py-2.5 shadow-[var(--shadow-menu)] group-hover/new:block">
              <div className="absolute top-1/2 left-[-5px] h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-board bg-card" />
              <p className="text-13 font-medium text-primary">开启新对话</p>
              <p className="mt-0.5 text-12 leading-snug text-muted">
                开始一次全新对话。发送消息前不会出现在会话列表。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 标签行：搜索 ↔ 排序（搜索态占位标签行） */}
      <div className="flex items-center justify-between gap-2 px-6 pt-1 pb-1">
        {searchOpen ? (
          <div className="flex h-5 min-w-0 flex-1 items-center gap-1.5">
            <Search size={12} strokeWidth={1.8} className="shrink-0 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  setSearchOpen(false);
                }
              }}
              placeholder="过滤会话…"
              className="min-w-0 flex-1 bg-transparent text-13 text-primary outline-none placeholder:text-muted"
              data-sidebar-action="search-input"
            />
            <button
              type="button"
              aria-label="关闭搜索"
              className="shrink-0 cursor-pointer text-muted hover:text-primary"
              onClick={() => {
                setQuery('');
                setSearchOpen(false);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <span className="text-13 text-muted select-none">会话</span>
        )}
        {!searchOpen && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              title="搜索会话（标题过滤）"
              aria-label="搜索会话"
              data-sidebar-action="search-toggle"
              onClick={() => setSearchOpen(true)}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary active:scale-[0.98]"
            >
              <Search size={12} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              title={sortBy === 'created' ? '当前：按创建时间排序（点击切换为最近活跃）' : '当前：按最近活跃排序（点击切换为创建时间）'}
              aria-label="切换会话排序"
              data-sidebar-action="sort-toggle"
              onClick={() => {
                const next = sortBy === 'created' ? 'active' : 'created';
                setSortBy(next);
                try {
                  localStorage.setItem('longma.sidebar-sort', next);
                } catch { /* localStorage 不可用时仅会话内生效 */ }
              }}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-primary active:scale-[0.98]"
            >
              {sortBy === 'created' ? (
                <CalendarClock size={12} strokeWidth={1.8} />
              ) : (
                <Activity size={12} strokeWidth={1.8} />
              )}
            </button>
          </div>
        )}
      </div>

      {/* 会话列表 */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-2">
        {sessions.length === 0 && (
          <div className="px-3 pt-1 text-13 text-muted select-none">还没有会话</div>
        )}

        {searching ? (
          <>
            {filterList([...pinnedSessions, ...unpinnedSessions]).map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={s.id === activeId}
                isRunning={runningIds.has(s.id)}
                attention={attentionIds.get(s.id)}
                isPinned={pinnedSet.has(s.id)}
                onTogglePin={togglePin}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
            {filterList([...pinnedSessions, ...unpinnedSessions]).length === 0 && (
              <div className="px-3 pt-1 text-13 text-muted select-none">没有匹配的会话</div>
            )}
          </>
        ) : (
          <>
            {pinnedSessions.length > 0 && (
              <div className="px-3 pt-1 pb-0.5 text-12 text-muted select-none" data-sidebar-pinned-label="true">
                置顶 · 拖动排序
              </div>
            )}
            {pinnedSessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={s.id === activeId}
                isRunning={runningIds.has(s.id)}
                attention={attentionIds.get(s.id)}
                isPinned
                draggable
                onTogglePin={togglePin}
                onDragStart={setDragId}
                onDragOverRow={handleDragOverRow}
                onDragEnd={handleDragEnd}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
            {pinnedSessions.length > 0 && unpinnedSessions.length > 0 && (
              <div className="my-1 px-3 text-12 text-muted select-none">会话</div>
            )}
            {filterList(unpinnedSessions).map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={s.id === activeId}
                isRunning={runningIds.has(s.id)}
                attention={attentionIds.get(s.id)}
                onTogglePin={togglePin}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
          </>
        )}
      </div>

      {/* 底部：设置入口（对齐 Cindy 用户胶囊位：icon 圆 + 文字的 pill 卡） */}
      <div className="px-3 pb-3">
        <Link
          to="/settings"
          className="flex items-center gap-2.5 rounded-full bg-card px-3 py-2 transition-colors hover:bg-hover active:scale-[0.98] select-none"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-board text-secondary">
            {profile.avatar ? (
              <img src={profile.avatar} alt="" className="h-6 w-6 object-cover" />
            ) : (
              <UserRound size={13} strokeWidth={1.8} />
            )}
          </span>
          <span className="min-w-0 truncate text-13 leading-tight font-medium text-primary">
            {profile.name || '设置'}
          </span>
        </Link>
      </div>
    </aside>
  );
}
