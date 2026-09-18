/**
 * CommandPalette —— Ctrl+K 命令面板（对齐 Cindy cmd palette 的最小版）。
 * 全局 keydown 监听（非输入态也响应）；↑↓ 循环高亮、Enter 执行、Esc 关闭、
 * 输入即过滤。动作三类：路由跳转 / 主题切换 / 杂项（新对话经 DOM 事件由
 * ChatPage 认领——它持有 createSession 上下文）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { setThemeMode, type ThemeMode } from '../themes/useTheme';
import { getDefaultWorkDir } from '../lib/defaults';
import { showToast } from '../lib/toast';

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export const NEW_CHAT_EVENT = 'longma:new-chat';

export function CommandPalette(): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setActive(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 渲染在 RouterProvider 外（main.tsx 根层），哈希路由直接改 location.hash
  const go = useCallback((path: string): void => {
    location.hash = path;
  }, []);

  const actions = useMemo<PaletteAction[]>(() => {
  const theme: ThemeMode[] = ['light', 'dark', 'system'];
  const themeLabel: Record<ThemeMode, string> = { light: '浅色', dark: '深色', system: '跟随系统' };
  return [
    { id: 'new-chat', label: '新对话', hint: '回主页并新建', run: () => { go('/'); window.dispatchEvent(new CustomEvent(NEW_CHAT_EVENT)); } },
    { id: 'settings', label: '打开设置', run: () => go('/settings') },
    { id: 'debug', label: '调试台', run: () => go('/debug') },
    ...theme.map((m) => ({
      id: `theme-${m}`,
      label: `主题：${themeLabel[m]}`,
      run: () => setThemeMode(m),
    })),
    {
      id: 'open-workdir',
      label: '打开默认工作目录',
      run: () => {
        const dir = getDefaultWorkDir();
        if (!dir) {
          showToast('还没设置默认工作目录（设置 → 通用）', 'error');
          return;
        }
        void window.fundet.openPath(dir).then((r) => {
          if (!r.success && r.failureKind !== 'ipc_lifecycle') {
            showToast(`打开目录失败：${r.error ?? dir}`, 'error');
          }
        });
      },
    },
  ];
  }, [go]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q) || a.id.includes(q));
  }, [actions, query]);

  const runAt = useCallback(
    (idx: number) => {
      const act = filtered[idx];
      if (!act) return;
      setOpen(false);
      act.run();
    },
    [filtered],
  );

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-[14vh]" onMouseDown={() => setOpen(false)}>
      <div
        className="animate-float-in w-[min(460px,calc(100vw-32px))] rounded-container border border-board bg-card shadow-[var(--shadow-menu)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => (filtered.length ? (i + 1) % filtered.length : 0));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              runAt(active);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder="输入命令…（↑↓ 选择，Enter 执行，Esc 关闭）"
          className="w-full border-b border-board bg-transparent px-4 py-3 text-14 text-primary outline-none placeholder:text-muted"
        />
        <div className="max-h-[300px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="px-3 py-3 text-13 text-muted">没有匹配的命令</div>
          )}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className={cn(
                'flex w-full items-center justify-between rounded-inner px-3 py-2 text-left text-13',
                i === active ? 'bg-accent text-accent-fg' : 'text-primary hover:bg-hover',
              )}
              onMouseEnter={() => setActive(i)}
              onClick={() => runAt(i)}
            >
              <span>{a.label}</span>
              {a.hint && <span className={cn('text-12', i === active ? 'text-accent-fg opacity-70' : 'text-muted')}>{a.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
