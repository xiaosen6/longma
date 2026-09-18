/**
 * SessionTreePanel —— 会话分支树查看/切换（pi 原生分支，对齐 Cindy 分支导航的最小版）。
 * 列出树里的 user 消息节点（分支点），活动路径高亮；点击切换到该分支——
 * main 侧会用 agent-core 给的安全时间线重写本会话消息，渲染层整体重建。
 */
import { useEffect, useMemo, useState } from 'react';
import { GitBranch, LoaderCircle } from 'lucide-react';
import type { SessionTreeSnapshot, SessionTreeNode } from '@fundet/agent-core';
import { cn } from '../lib/cn';
import { hasFramelessControls } from './WindowControls';

interface FlatNode {
  id: string;
  preview: string;
  timestamp?: string;
  depth: number;
  active: boolean;
  isLeaf: boolean;
}

function flattenUserNodes(roots: SessionTreeNode[], activePathIds: Set<string>, leafId: string | null): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (nodes: SessionTreeNode[], depth: number): void => {
    for (const n of nodes) {
      if (n.kind === 'message' && n.role === 'user') {
        out.push({
          id: n.id,
          preview: n.preview.slice(0, 60),
          timestamp: n.timestamp,
          depth,
          active: activePathIds.has(n.id),
          isLeaf: n.id === leafId,
        });
      }
      walk(n.children, n.kind === 'message' && n.role === 'user' ? depth + 1 : depth);
    }
  };
  walk(roots, 0);
  return out;
}

export function SessionTreeButton(props: {
  sessionId: string;
  onNavigated: () => void;
  onError: (message: string) => void;
}): React.JSX.Element | null {
  const { sessionId, onNavigated, onError } = props;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<SessionTreeSnapshot | null>(null);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setTree(null);
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void window.fundet
      .getSessionTree(sessionId)
      .then((t) => {
        if (!cancelled) setTree(t);
      })
      .catch(() => {
        if (!cancelled) setTree(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const nodes = useMemo(
    () => (tree ? flattenUserNodes(tree.roots, new Set(tree.activePathIds), tree.leafId) : []),
    [tree],
  );

  const navigate = (entryId: string): void => {
    setNavigatingId(entryId);
    void window.fundet
      .navigateSessionTree(sessionId, entryId)
      .then(() => {
        setOpen(false);
        onNavigated();
      })
      .catch((err: unknown) => {
        onError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setNavigatingId(null));
  };

  return (
    <div className="relative">
      <button
        type="button"
        title="分支历史"
        aria-label="分支历史"
        data-sidebar-action="tree-toggle"
        className={cn(
          'no-drag flex h-6 w-6 cursor-pointer items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-hover hover:text-primary active:scale-[0.98]',
          open && 'bg-hover text-primary',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <GitBranch size={13} strokeWidth={1.8} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setOpen(false)} />
          <div
            className={cn(
              'animate-float-in absolute top-7 right-0 z-40 w-[320px] rounded-container border border-board bg-card shadow-[var(--shadow-menu)]',
              hasFramelessControls() && 'mr-[140px]',
            )}
          >
            <div className="border-b border-board px-3 py-2 text-13 font-medium text-primary select-none">
              分支历史
            </div>
            <div className="max-h-[320px] overflow-y-auto p-1">
              {loading && (
                <div className="flex items-center gap-2 px-2 py-3 text-13 text-muted">
                  <LoaderCircle size={13} className="animate-fundet-spin" />
                  读取分支…
                </div>
              )}
              {!loading && tree == null && (
                <div className="px-2 py-3 text-13 text-muted">
                  这个会话暂时读不到分支树（需会话在运行中且 pi 支持分支）。
                </div>
              )}
              {!loading && tree != null && nodes.length === 0 && (
                <div className="px-2 py-3 text-13 text-muted">还没有分支点。</div>
              )}
              {nodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  disabled={navigatingId != null || n.isLeaf}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-13',
                    n.active ? 'bg-accent text-accent-fg' : 'text-primary hover:bg-hover',
                    (navigatingId != null || n.isLeaf) && 'cursor-default opacity-70',
                  )}
                  style={{ paddingLeft: `${8 + n.depth * 14}px` }}
                  onClick={() => navigate(n.id)}
                >
                  <GitBranch size={11} className="shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1 truncate">{n.preview || '（无文本）'}</span>
                  {n.isLeaf ? (
                    <span className="shrink-0 text-11 opacity-70">当前</span>
                  ) : (
                    navigatingId === n.id && <LoaderCircle size={11} className="shrink-0 animate-fundet-spin" />
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-board px-3 py-1.5 text-11 text-muted select-none">
              点击切换到该分支；当前分支之后的消息会留在原分支上。
            </div>
          </div>
        </>
      )}
    </div>
  );
}
