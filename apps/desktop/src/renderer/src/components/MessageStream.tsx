/**
 * MessageStream — 消息滚动容器。
 *
 * 自动贴底：用户上滑超过阈值则暂停贴底（回读到底部恢复），新内容到来时
 * 只有处于贴底态才滚动。渲染 slice.items + 未封口的流式文本。
 *
 * 视觉复刻 Cindy 消息流：
 * - 用户气泡：右对齐、max-w-[488px]、Card 底 + 1px Board + 12px 圆角、px-4 py-3、
 *   text-15 leading-[1.6]。
 * - 助手正文：无气泡，通栏 text-15 leading-[1.6]（.md 样式在 globals.css）。
 * - thinking / 工具卡片：见各自组件（无卡片边框的 rail 风格 / 12px 卡片）。
 * - 错误卡：error token 三件套；系统通知：居中灰字。
 * - 条目间距 gap-3.5（14px，对齐 Cindy msg-stream-items）。
 * - 每轮完成后的助手消息挂 MessageActionBar（复制 / 分享 / 分叉 / 更多），
 *   不含「复制当前消息链接」。
 */
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { AlertCircle, ArrowDown, Check, Copy, Ellipsis, Info, Pencil, Share, Split } from 'lucide-react';
import type { DisplayItem, SessionSlice } from '../stores/sessionStore';
import { deleteFromUserMessage } from '../stores/sessionStore';
import { AssistantMessage } from './AssistantMessage';
import { MessageActionBar } from './MessageActionBar';
import { ShareTurnModal, type ShareTurnPayload } from './ShareTurnModal';
import { groupWorkItems, WorkGroupBlock } from './WorkGroupBlock';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { KnowledgeRef } from '../../../shared/fundet-api.ts';
import { cn } from '../lib/cn';
import { mayExceedVisualLineThreshold, useUserMessageAutoCollapse } from './chat/userMessageCollapse';

/** 距底部多少 px 内视为贴底 */
const STICK_THRESHOLD = 48;

/**
 * 每会话「上次滚动位置」内存表（简版 sessionScrollStore）：
 * 切回会话时还原 scrollTop 而不是甩到底部。只记像素值不做条目锚点——
 * 上方内容异步撑高时会失真，但远好于每次归零；完整锚点版等有真实需要再做。
 */
const scrollMemory = new Map<string, number>();
/** 用户消息操作条图标按钮样式（对齐 MessageActionBar ICON_BTN） */
const USER_ICON_BTN =
  'flex h-6 w-6 items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-hover hover:text-primary disabled:opacity-40';

function formatRelativeUser(ts: number): string {
  const d = Date.now() - ts;
  if (d < 45_000) return '刚刚';
  if (d < 3_600_000) return `${Math.max(1, Math.round(d / 60_000))} 分钟前`;
  if (d < 86_400_000) return `${Math.max(1, Math.round(d / 3_600_000))} 小时前`;
  return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 用户消息气泡：长文本自动收起（抄 Cindy userMessageCollapse：镜像节点实测行数
 * + ResizeObserver 跟宽重算），折叠态 line-clamp-10 + 「展开全文 / 收起」。
 * 下方操作条（hover 显示，对齐 Cindy 图标形态）：时间 + 复制/分享/分叉/编辑/更多。
 * 编辑 = 就地编辑后从本条起重发（删除本条及之后全部消息）。 */
function UserBubble({
  text,
  attachments,
  onOpenFile,
  onEdit,
  createdAt,
  onCopy,
  onShare,
  onFork,
  onDeleteAfter,
}: {
  text: string;
  attachments?: Array<{ path: string; name: string }>;
  onOpenFile?: (path: string) => void;
  onEdit?: (newText: string) => void;
  createdAt?: number;
  onCopy?: (text: string) => Promise<void>;
  onShare?: () => void;
  onFork?: () => void | Promise<void>;
  onDeleteAfter?: () => Promise<void>;
}) {
  const mayExceed = mayExceedVisualLineThreshold(text);
  const { mirrorRef, shouldCollapse } = useUserMessageAutoCollapse(text, mayExceed);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const collapsed = shouldCollapse && !expanded;
  const actionsVisible = hovered || menuOpen;

  const commitEdit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === text || !onEdit) return;
    onEdit(next);
  };

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[488px] rounded-container border border-board bg-card px-3 py-2.5">
          <textarea
            autoFocus
            value={draft}
            rows={Math.min(10, draft.split('\n').length + 1)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commitEdit();
              }
            }}
            className="w-full resize-none bg-transparent text-15 leading-[1.6] text-primary outline-none"
          />
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-full px-2.5 py-1 text-12 text-secondary hover:bg-hover hover:text-primary"
              onClick={() => setEditing(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-full bg-accent px-2.5 py-1 text-12 text-accent-fg"
              onClick={commitEdit}
            >
              发送
            </button>
          </div>
        </div>
      </div>
    );
  }

  const doCopy = async (): Promise<void> => {
    if (!onCopy) return;
    await onCopy(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="group/user flex flex-col items-end" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="max-w-[488px] rounded-container border border-board bg-card px-4 py-3 text-15 leading-[1.6] text-primary select-text">
        {attachments && attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <button
                key={a.path}
                type="button"
                title={a.path}
                className="max-w-full truncate rounded-full border border-board bg-chip px-2 py-0.5 text-11 text-secondary hover:text-primary"
                onClick={() => onOpenFile?.(a.path)}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
        {mayExceed ? (
          <div
            ref={mirrorRef}
            aria-hidden
            className="max-h-0 overflow-hidden whitespace-pre-wrap break-words text-15 leading-[1.6] [overflow-wrap:anywhere]"
          >
            {text}
          </div>
        ) : null}
        <div
          className={cn(
            'whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
            collapsed && 'line-clamp-10',
          )}
        >
          {text}
        </div>
        {shouldCollapse ? (
          <button
            type="button"
            className="mt-1.5 flex items-center gap-1 text-13 text-secondary hover:text-primary"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : '展开全文'}
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        ) : null}
      </div>
      {/* 操作条（对齐 Cindy 用户消息：时间 + 复制/分享/分叉/编辑/更多，hover 显示） */}
      <div
        className={cn(
          'mt-0.5 flex h-6 items-center gap-0.5 transition-opacity duration-150',
          actionsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {createdAt ? (
          <span className="mr-1 text-12 text-muted" title={new Date(createdAt).toLocaleString('zh-CN')}>
            {formatRelativeUser(createdAt)}
          </span>
        ) : null}
        <button
          type="button"
          className={USER_ICON_BTN}
          title={copied ? '已复制' : '复制'}
          aria-label="复制"
          onClick={() => void doCopy()}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        {onShare ? (
          <button type="button" className={USER_ICON_BTN} title="分享为图片" aria-label="分享为图片" onClick={onShare}>
            <Share size={14} />
          </button>
        ) : null}
        {onFork ? (
          <button
            type="button"
            className={USER_ICON_BTN}
            title="分叉到新会话"
            aria-label="分叉到新会话"
            disabled={forking}
            onClick={() => {
              if (forking) return;
              setForking(true);
              Promise.resolve(onFork()).finally(() => setForking(false));
            }}
          >
            <Split size={14} />
          </button>
        ) : null}
        {onEdit ? (
          <button
            type="button"
            className={USER_ICON_BTN}
            title="编辑并从这条重新生成"
            aria-label="编辑"
            onClick={() => { setDraft(text); setEditing(true); }}
          >
            <Pencil size={14} />
          </button>
        ) : null}
        {onDeleteAfter ? (
          <div className="relative">
            <button
              type="button"
              className={USER_ICON_BTN}
              title="更多"
              aria-label="更多"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Ellipsis size={14} />
            </button>
            {menuOpen && (
              <div className="absolute bottom-full right-0 z-20 mb-1 w-[180px] rounded-xl border border-board bg-card p-1 shadow-[var(--shadow-menu)]">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-13 text-error hover:bg-hover"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleting(true);
                    void onDeleteAfter().finally(() => setDeleting(false));
                  }}
                >
                  删除本条及之后{deleting ? '…' : ''}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type AssistantItem = Extract<DisplayItem, { kind: 'assistant' }>;
type GroupedRow = ReturnType<typeof groupWorkItems>[number];

interface MessageStreamProps {
  /** 所属会话：滚动位置记忆的 key */
  sessionId: string;
  slice: SessionSlice;
  workDir?: string;
  onOpenFile?: (path: string) => void;
  canFork?: boolean;
  onFork?: (createdAt: number) => Promise<void>;
  onAddToChat?: (text: string) => void;
  onDelete?: (assistantId: string) => Promise<void>;
  /** 终态错误卡的「重新发送」：重发本轮最后一条用户消息 */
  onRetryError?: () => void;
  /** 用户消息编辑重发（就地编辑→删除本条及之后→发送新文本） */
  onEditUser?: (userId: string, newText: string) => Promise<void>;
}

function isTurnTailAssistant(
  grouped: GroupedRow[],
  index: number,
  isRunning: boolean,
  hasStreaming: boolean,
): boolean {
  const item = grouped[index];
  if (!item || item.kind !== 'assistant') return false;
  for (let j = index + 1; j < grouped.length; j++) {
    const next = grouped[j];
    if (next.kind === 'assistant' || next.kind === 'work_group') return false;
    if (next.kind === 'user') return true;
  }
  return !isRunning && !hasStreaming;
}

function lastUserTextBefore(items: DisplayItem[], assistantId: string): string {
  const idx = items.findIndex((it) => it.kind === 'assistant' && it.id === assistantId);
  if (idx < 0) return '';
  for (let i = idx - 1; i >= 0; i--) {
    const prev = items[i];
    if (prev.kind === 'user') return prev.text;
  }
  return '';
}

/** 溯源角标数据：assistant 回复对应的上游 user 消息携带的知识库引用 */
function lastUserKbRefsBefore(items: DisplayItem[], assistantId: string): KnowledgeRef[] | undefined {
  const idx = items.findIndex((it) => it.kind === 'assistant' && it.id === assistantId);
  const from = idx >= 0 ? idx : items.length; // 流式文本（无 id 命中）取最后一条 user
  for (let i = from - 1; i >= 0; i--) {
    const prev = items[i];
    if (prev.kind === 'user') return prev.kbRefs;
  }
  return undefined;
}

function AssistantTurn({
  item,
  pinned,
  workDir,
  onOpenFile,
  onShare,
  onFork,
  onAddToChat,
  onDelete,
  kbRefs,
}: {
  item: AssistantItem;
  pinned: boolean;
  workDir?: string;
  onOpenFile?: (path: string) => void;
  onShare?: () => void;
  onFork?: () => Promise<void>;
  onAddToChat?: () => void;
  onDelete?: () => Promise<void>;
  kbRefs?: KnowledgeRef[];
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex justify-start"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="w-full max-w-full min-w-0">
        <AssistantMessage text={item.text} workDir={workDir} onOpenFile={onOpenFile} kbRefs={kbRefs} />
        <MessageActionBar
          createdAt={item.createdAt}
          copyText={item.text}
          usage={item.usage}
          hovered={hovered}
          pinned={pinned}
          onShare={onShare}
          onFork={onFork}
          onAddToChat={onAddToChat}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

export function MessageStream({
  sessionId,
  slice,
  workDir,
  onOpenFile,
  canFork,
  onFork,
  onAddToChat,
  onDelete,
  onRetryError,
  onEditUser,
}: MessageStreamProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  /** 回读锚点：视口顶端第一条消息元素 + 它相对视口顶的偏移（贴底时不记录） */
  const anchorRef = useRef<{ el: Element; offset: number } | null>(null);
  const stickRef = useRef(true);
  const lastScrollRef = useRef<number | null>(null);
  const prevSessionRef = useRef(sessionId);
  const [atBottom, setAtBottom] = useState(true);
  const [sharePayload, setSharePayload] = useState<ShareTurnPayload | null>(null);
  const grouped = useMemo(
    () => groupWorkItems(slice.items, slice.isRunning),
    [slice.items, slice.isRunning],
  );
  const hasStreaming = Boolean(slice.streamingText);
  const pinnedId = useMemo(() => {
    if (slice.isRunning || hasStreaming) return null;
    for (let i = grouped.length - 1; i >= 0; i--) {
      const it = grouped[i];
      if (it.kind === 'assistant') return it.id;
    }
    return null;
  }, [grouped, slice.isRunning, hasStreaming]);

  const handleScroll = (): void => {
    const el = containerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stickRef.current = near;
    setAtBottom(near);
    lastScrollRef.current = el.scrollTop;
    captureAnchor();
  };

  /** 记录回读锚点：视口顶端第一条可见消息及其偏移（贴底态无需补偿，清空） */
  const captureAnchor = (): void => {
    const el = containerRef.current;
    const inner = innerRef.current;
    if (!el || !inner || stickRef.current) {
      anchorRef.current = null;
      return;
    }
    const elTop = el.getBoundingClientRect().top;
    for (const child of Array.from(inner.children)) {
      const r = child.getBoundingClientRect();
      if (r.bottom > elTop) {
        anchorRef.current = { el: child, offset: r.top - elTop };
        return;
      }
    }
    anchorRef.current = null;
  };

  // 滚动补偿：回读中上方内容异步撑高（图片/代码块/markdown）时，把锚点条目修回原视口位置。
  // 贴底（流式跟随）时不补偿——增长在下方，天然不需要。
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      const anchor = anchorRef.current;
      if (!el || !anchor || stickRef.current || !anchor.el.isConnected) return;
      const elTop = el.getBoundingClientRect().top;
      const drift = anchor.el.getBoundingClientRect().top - elTop - anchor.offset;
      if (Math.abs(drift) > 1) {
        el.scrollTop += drift;
        requestAnimationFrame(() => captureAnchor());
      }
    });
    ro.observe(inner);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 会话切换：把离开时的位置记入内存表（render 期检测，handleScroll 只维护 lastScrollRef）
  if (prevSessionRef.current !== sessionId) {
    if (lastScrollRef.current != null) {
      scrollMemory.set(prevSessionRef.current, lastScrollRef.current);
    }
    prevSessionRef.current = sessionId;
  }

  // 内容变化时贴底（用 useLayoutEffect 避免闪烁）；非贴底时同步回读锚点
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    captureAnchor();
  }, [slice.items, slice.streamingText]);

  /** 回到底部（JumpToBottomChip）：smooth 一次性跳底并恢复贴底跟随 */
  const jumpToBottom = (): void => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // 切换会话（items 引用整体替换）时：有记忆且非贴底态则还原位置，否则贴底
  useEffect(() => {
    const remembered = scrollMemory.get(sessionId);
    if (remembered != null && remembered > STICK_THRESHOLD) {
      // 延后一个宏任务再恢复（items/scrollHeight 已 commit）。不用 rAF——
      // 窗口被遮挡时 Chromium 暂停 rAF，恢复会永不执行（实测踩坑）
      const timer = setTimeout(() => {
        const el = containerRef.current;
        if (!el) return;
        stickRef.current = false;
        setAtBottom(false);
        el.scrollTop = Math.min(remembered, el.scrollHeight);
      }, 0);
      return () => clearTimeout(timer);
    }
    stickRef.current = true;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.historyLoaded, sessionId]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-6 py-4"
      >
        <div ref={innerRef} className="mx-auto flex max-w-[820px] flex-col gap-3.5">
          {slice.items.length === 0 && !slice.streamingText && (
            <div className="pt-24 text-center text-13 text-muted select-none">
              输入消息或拖入文件开始对话
            </div>
          )}

        {grouped.map((item, index) => {
          if (item.kind === 'work_group') {
            return (
              <WorkGroupBlock
                key={item.id}
                childrenItems={item.children}
                streaming={item.streaming}
                workDir={workDir}
                onOpenFile={onOpenFile}
              />
            );
          }
          switch (item.kind) {
            case 'user': {
              // 分享：取本条之后最近的 assistant 回复组成回合（无回复则不显示分享钮）
              const userIdx = slice.items.findIndex((it) => it.kind === 'user' && it.id === item.id);
              let replyText: string | undefined;
              for (let j = userIdx + 1; j < slice.items.length; j++) {
                const it = slice.items[j];
                if (it.kind === 'assistant') { replyText = it.text; break; }
              }
              const canEdit = Boolean(onEditUser) && canFork && !slice.isRunning;
              const editUser = onEditUser;
              return (
                <UserBubble
                  key={item.id}
                  text={item.text}
                  attachments={item.attachments}
                  onOpenFile={onOpenFile}
                  createdAt={item.createdAt}
                  onCopy={async (t) => { await window.fundet.copyText(t); }}
                  onShare={replyText !== undefined ? () => setSharePayload({ userText: item.text, assistantText: replyText, createdAt: item.createdAt }) : undefined}
                  onFork={
                    canFork && item.createdAt !== undefined && item.createdAt !== null && onFork
                      ? () => {
                          const ts = item.createdAt;
                          if (typeof ts !== 'number') return;
                          void onFork(ts);
                        }
                      : undefined
                  }
                  onEdit={canEdit && editUser ? (newText) => void editUser(item.id, newText) : undefined}
                  onDeleteAfter={
                    canEdit
                      ? async () => {
                          await deleteFromUserMessage(sessionId, item.id);
                        }
                      : undefined
                  }
                />
              );
            }
            case 'assistant': {
              const showBar = isTurnTailAssistant(grouped, index, slice.isRunning, hasStreaming);
              const kbRefs = lastUserKbRefsBefore(slice.items, item.id);
              if (!showBar) {
                return (
                  <div key={item.id} className="flex justify-start">
                    <div className="w-full max-w-full min-w-0">
                      <AssistantMessage text={item.text} workDir={workDir} onOpenFile={onOpenFile} kbRefs={kbRefs} />
                    </div>
                  </div>
                );
              }
              const userText = lastUserTextBefore(slice.items, item.id);
              const createdAt = item.createdAt;
              return (
                <AssistantTurn
                  key={item.id}
                  item={item}
                  pinned={item.id === pinnedId}
                  workDir={workDir}
                  onOpenFile={onOpenFile}
                  kbRefs={kbRefs}
                  onShare={() =>
                    setSharePayload({
                      userText,
                      assistantText: item.text,
                      createdAt: item.createdAt,
                    })
                  }
                  onFork={
                    canFork && createdAt && onFork ? () => onFork(createdAt) : undefined
                  }
                  onAddToChat={onAddToChat ? () => onAddToChat(item.text) : undefined}
                  onDelete={onDelete ? () => onDelete(item.id) : undefined}
                />
              );
            }
            case 'error':
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-2 rounded-inner border border-error-border bg-error-bg px-3 py-2"
                >
                  <AlertCircle size={14} className="mt-[2px] shrink-0 text-error" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-13 break-all whitespace-pre-wrap text-error select-text">
                      {item.message}
                    </span>
                    {onRetryError && (
                      <button
                        type="button"
                        onClick={onRetryError}
                        className="mt-1.5 rounded-full border border-error-border px-2.5 py-0.5 text-12 text-error transition-colors hover:bg-error-bg/60"
                      >
                        重新发送
                      </button>
                    )}
                  </div>
                </div>
              );
            case 'notice':
              return (
                <div key={item.id} className="flex items-center justify-center gap-1.5 select-none">
                  <Info size={12} className="text-muted" />
                  <span className="text-12 text-muted">{item.text}</span>
                </div>
              );
            default:
              return null;
          }
        })}

        {/* 未封口的流式文本（逐词淡入由 AssistantMessage streaming 分支处理） */}
        {slice.streamingText && (
          <div className="flex justify-start">
            <div className="w-full max-w-full min-w-0">
              <AssistantMessage
                text={slice.streamingText}
                streaming
                workDir={workDir}
                onOpenFile={onOpenFile}
                kbRefs={lastUserKbRefsBefore(slice.items, '__streaming__')}
              />
            </div>
          </div>
        )}
        </div>
      </div>
      {/* 回到底部浮标：非贴底且正在产出内容时提示失联，点击恢复跟随 */}
      {!atBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-4 right-6 flex items-center gap-1.5 rounded-full border border-board bg-card px-3 py-1.5 text-12 text-primary shadow-md transition-colors hover:bg-hover"
        >
          <ArrowDown size={13} />
          回到底部
          {(slice.isRunning || hasStreaming) && (
            <span className="ml-0.5 inline-block h-[6px] w-[6px] rounded-full bg-accent" />
          )}
        </button>
      )}
      {sharePayload ? (
        <ShareTurnModal payload={sharePayload} onClose={() => setSharePayload(null)} />
      ) : null}
    </div>
  );
}
