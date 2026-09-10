/**
 * McpPanel — 设置 →「MCP 服务器」整页分区。
 * 列表带连通状态点（绿=可达 / 红=失败 / 灰=未检测，检测中灰点呼吸），
 * 进入面板自动检测一轮，「检测连接」可手动重测（http 发 initialize、stdio 走握手）。
 * 改动只影响之后新建的会话。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { McpServerView } from '../../../../shared/fundet-api.ts';
import { McpServerDialog } from '../../components/settings/McpServerDialog';

type ProbeState = 'idle' | 'testing' | 'ok' | 'fail';

function StatusDot({ state, title }: { state: ProbeState; title: string }): React.JSX.Element {
  const color =
    state === 'ok'
      ? 'bg-emerald-500'
      : state === 'fail'
        ? 'bg-red-500'
        : 'bg-neutral-400';
  return (
    <span
      title={title}
      className={
        'inline-block h-[8px] w-[8px] shrink-0 rounded-full ' + color + (state === 'testing' ? ' animate-pulse' : '')
      }
    />
  );
}

export function McpPanel(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [probes, setProbes] = useState<Record<string, { state: ProbeState; detail: string }>>({});
  const [editing, setEditing] = useState<McpServerView | 'new' | null>(null);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback((): void => {
    void window.fundet
      .listMcpServers()
      .then(setServers)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const probeAll = useCallback((list: McpServerView[]): void => {
    if (list.length === 0) return;
    setProbing(true);
    setProbes((prev) => {
      const next = { ...prev };
      for (const s of list) next[s.id] = { state: 'testing', detail: '检测中…' };
      return next;
    });
    for (const s of list) {
      void window.fundet
        .testMcpConnection(s.id)
        .then((r) => {
          if (!mountedRef.current) return;
          setProbes((prev) => ({
            ...prev,
            [s.id]: { state: r.ok ? 'ok' : 'fail', detail: r.ok ? `已连通（${r.latencyMs}ms）` : r.error ?? '连接失败' },
          }));
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          setProbes((prev) => ({
            ...prev,
            [s.id]: { state: 'fail', detail: err instanceof Error ? err.message : String(err) },
          }));
        });
    }
    // 没有统一完成信号：全部 settle 后由最慢者自然结束即可；这里以最短 1.2s 兜底解除按钮态
    setTimeout(() => {
      if (mountedRef.current) setProbing(false);
    }, 1500);
  }, []);

  useEffect(() => {
    void window.fundet
      .listMcpServers()
      .then((list) => {
        setServers(list);
        probeAll(list);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      mountedRef.current = false;
    };
  }, [probeAll]);

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
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-16 leading-[1.2] font-medium text-primary">MCP 服务器</h2>
          <p className="mt-1 text-13 text-secondary">
            接入外部工具服务（本地进程或远程端点），新对话自动挂载给助手调用。
            改动对之后新建的对话生效。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={probing || servers.length === 0}
            onClick={() => probeAll(servers)}
            className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 font-medium text-primary transition-colors hover:bg-hover disabled:opacity-50"
          >
            <RefreshCw size={13} className={probing ? 'animate-spin' : ''} />
            检测连接
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg"
          >
            <Plus size={13} />
            新建
          </button>
        </div>
      </div>
      {error && <p className="text-12 text-error">{error}</p>}
      {servers.length === 0 ? (
        <div className="rounded-xl border border-board bg-card-ivory px-5 py-6 text-13 text-muted">
          还没有配置 MCP 服务器。填一个 streamable-http 端点，或本地的 stdio 启动命令即可。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {servers.map((s) => {
            const probe = probes[s.id] ?? { state: 'idle' as ProbeState, detail: '未检测' };
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-board bg-card-ivory px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusDot state={probe.state} title={probe.detail} />
                    <span className={'truncate text-14 font-medium ' + (s.enabled ? 'text-primary' : 'text-muted')}>
                      {s.name}
                    </span>
                    <span className="rounded-full bg-chip px-2 py-0.5 text-11 text-muted">
                      {s.type === 'stdio' ? '本地' : '远程'}
                    </span>
                    {s.hasToken && (
                      <span className="rounded-full bg-chip px-2 py-0.5 text-11 text-muted">token</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-11 text-muted">
                    {s.type === 'stdio'
                      ? [s.command, ...s.args].filter(Boolean).join(' ')
                      : s.url}
                  </p>
                  {probe.state === 'fail' && (
                    <p className="mt-0.5 truncate text-11 text-error">{probe.detail}</p>
                  )}
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
                  className="relative h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full bg-chip data-[state=checked]:bg-accent"
                >
                  <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[18px]" />
                </Switch.Root>
              </div>
            );
          })}
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
