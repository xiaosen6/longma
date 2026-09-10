/**
 * McpServersSection — 设置 → 自动操作「MCP 服务器」分区。
 * 用户自定义外部 MCP server（stdio 本地进程 / streamable-http 远程端点），
 * 新会话装配时注入（mcp-bridge）。Bearer token 走 safeStorage，明文不回显。
 * 配置即插即用：改动只影响之后新建的会话，进行中会话不变。
 */
import { useCallback, useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { McpServerView } from '../../../../shared/fundet-api.ts';
import { McpServerDialog } from './McpServerDialog';

export function McpServersSection(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [editing, setEditing] = useState<McpServerView | 'new' | null>(null);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void window.fundet
      .listMcpServers()
      .then(setServers)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  const toggle = (s: McpServerView, next: boolean): void => {
    setServers((prev) => prev.map((it) => (it.id === s.id ? { ...it, enabled: next } : it)));
    void window.fundet
      .updateMcpServer(s.id, { enabled: next })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        refresh();
      });
  };

  const remove = (s: McpServerView): void => {
    if (confirmId !== s.id) {
      setConfirmId(s.id);
      return;
    }
    setConfirmId(null);
    void window.fundet
      .deleteMcpServer(s.id)
      .then(refresh)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <div className="rounded-xl border border-board bg-card-ivory p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-13 font-medium text-secondary">MCP 服务器</p>
          <p className="mt-1 text-12 leading-[1.5] text-muted">
            接入外部工具服务（本地进程或远程端点），新对话自动挂载给助手调用。
            改动对之后新建的对话生效。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex shrink-0 items-center gap-1 rounded-full border border-board px-3 py-1.5 text-12 text-secondary transition-colors hover:text-primary"
        >
          <Plus size={14} /> 添加
        </button>
      </div>

      {error && <p className="mt-2 text-12 text-error">{error}</p>}

      {servers.length > 0 && (
        <div className="mt-3 border-t border-board pt-3">
          <div className="flex flex-col gap-2">
            {servers.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-lg border border-board bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-13 text-primary">{s.name}</span>
                    <span className="shrink-0 rounded-full border border-board px-1.5 text-11 text-muted">
                      {s.type === 'stdio' ? '本地' : '远程'}
                    </span>
                    {s.hasToken && (
                      <span className="shrink-0 rounded-full border border-board px-1.5 text-11 text-muted">
                        token
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-11 text-muted">
                    {s.type === 'stdio'
                      ? [s.command, ...s.args].filter(Boolean).join(' ')
                      : s.url}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  className="shrink-0 text-muted transition-colors hover:text-primary"
                  aria-label={`编辑 ${s.name}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(s)}
                  className={
                    'shrink-0 transition-colors ' +
                    (confirmId === s.id ? 'text-error' : 'text-muted hover:text-primary')
                  }
                  aria-label={`删除 ${s.name}`}
                >
                  <Trash2 size={14} />
                </button>
                <Switch.Root
                  checked={s.enabled}
                  onCheckedChange={(next) => toggle(s, next)}
                  className="relative h-[22px] w-[42px] shrink-0 cursor-pointer rounded-full border border-board bg-card transition-colors data-[state=checked]:bg-[var(--accent,#2563eb)]"
                >
                  <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[22px]" />
                </Switch.Root>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <McpServerDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
