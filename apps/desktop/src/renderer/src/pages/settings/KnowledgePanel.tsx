/**
 * KnowledgePanel — 设置 →「知识库」整页分区（纯全文检索，无模型依赖）。
 * 库列表 → 库详情（条目状态/添加文档/删除）→ 检索测试框（看召回效果）。
 * 索引异步进行：条目状态 pending/reading/indexing → completed/failed，轮询刷新。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Database, FilePlus2, FolderPlus, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { KnowledgeBaseView, KnowledgeItemView, KnowledgeSearchResult } from '../../../../shared/fundet-api.ts';

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-16 leading-[1.2] font-medium text-primary">{children}</h2>;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  reading: '读取中',
  indexing: '索引中',
  completed: '已完成',
  failed: '失败',
};

export function KnowledgePanel(): React.JSX.Element {
  const [bases, setBases] = useState<KnowledgeBaseView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<KnowledgeItemView[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(8);
  const [results, setResults] = useState<KnowledgeSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshBases = useCallback((): void => {
    void window.fundet
      .listKnowledgeBases()
      .then(setBases)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const refreshItems = useCallback((baseId: string): void => {
    void window.fundet
      .listKnowledgeItems(baseId)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // 有进行中的条目时轮询刷新状态
  useEffect(() => {
    const busy = items.some((it) => ['pending', 'reading', 'indexing'].includes(it.status));
    if (pollRef.current) clearInterval(pollRef.current);
    if (busy && selectedId) {
      pollRef.current = setInterval(() => refreshItems(selectedId), 1200);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [items, selectedId, refreshItems]);

  useEffect(refreshBases, [refreshBases]);

  const selected = bases.find((b) => b.id === selectedId) ?? null;

  const create = (): void => {
    const name = newName.trim();
    if (!name) return;
    void window.fundet
      .createKnowledgeBase(name)
      .then((b) => {
        setCreating(false);
        setNewName('');
        refreshBases();
        setSelectedId(b.id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const removeBase = (b: KnowledgeBaseView): void => {
    if (!window.confirm(`删除知识库「${b.name}」及其全部索引？文件本身不会被删除。`)) return;
    void window.fundet
      .deleteKnowledgeBase(b.id)
      .then(() => {
        if (selectedId === b.id) setSelectedId(null);
        refreshBases();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const addFiles = async (): Promise<void> => {
    if (!selectedId) return;
    setError('');
    const picked = await window.fundet.pickKnowledgeFiles();
    if (!picked || picked.length === 0) return;
    try {
      await window.fundet.addKnowledgeFiles(selectedId, picked);
      refreshItems(selectedId);
      refreshBases();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addDirectory = async (): Promise<void> => {
    if (!selectedId) return;
    setError('');
    const dir = await window.fundet.pickKnowledgeDirectory();
    if (!dir) return;
    try {
      const added = await window.fundet.addKnowledgeDirectory(selectedId, dir);
      setError(added.length > 0 ? '' : '该目录下没有支持的文档');
      refreshItems(selectedId);
      refreshBases();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const retryItem = async (it: KnowledgeItemView): Promise<void> => {
    setError('');
    try {
      await window.fundet.retryKnowledgeItem(it.id);
      if (selectedId) refreshItems(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeItem = async (it: KnowledgeItemView): Promise<void> => {
    setError('');
    try {
      await window.fundet.removeKnowledgeItem(it.id);
      if (selectedId) refreshItems(selectedId);
      refreshBases();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runSearch = (): void => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    void window.fundet
      .searchKnowledge(q, selectedId ?? undefined, topK)
      .then((r) => {
        setResults(r);
        setSearching(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSearching(false);
      });
  };

  const inputCls =
    'w-full rounded-lg border border-board bg-card px-3 py-2 text-13 text-primary outline-none placeholder:text-muted focus:border-[var(--accent,#2563eb)]';

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>知识库</SectionTitle>
          <p className="mt-1 max-w-[560px] text-13 text-secondary">
            导入本地文档（md / txt / pdf / docx），对话时助手会自动检索其中的内容来回答。
            全部数据只存本机，不依赖任何模型服务。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
          }}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg"
        >
          <Plus size={13} />
          新建知识库
        </button>
      </div>
      {error && <p className="text-12 text-error">{error}</p>}

      {/* 库列表 / 详情切换 */}
      {!selected ? (
        <div className="flex flex-col gap-2">
          {bases.length === 0 && !creating && (
            <div className="rounded-xl border border-board bg-card-ivory px-5 py-6 text-13 text-muted">
              还没有知识库。新建一个，把资料文档拖进来，对话时就能直接问里面的内容。
            </div>
          )}
          {bases.map((b) => (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelectedId(b.id);
                setResults(null);
                refreshItems(b.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSelectedId(b.id);
                  refreshItems(b.id);
                }
              }}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-board bg-card-ivory px-4 py-3 transition-colors hover:bg-hover"
            >
              <Database size={16} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-14 font-medium text-primary">{b.name}</p>
                <p className="mt-0.5 text-12 text-muted">
                  {b.fileCount} 个文件 · {b.chunkCount} 个内容块
                </p>
              </div>
              <button
                type="button"
                title="删除知识库"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBase(b);
                }}
                className="shrink-0 text-muted transition-colors hover:text-error"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {creating && (
            <div className="flex items-center gap-2 rounded-xl border border-board bg-card-ivory px-4 py-3">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') create();
                  if (e.key === 'Escape') setCreating(false);
                }}
                placeholder="知识库名称，如：产品手册"
                className={inputCls + ' max-w-[320px]'}
              />
              <button type="button" onClick={create} className="rounded-lg bg-accent px-3 py-1.5 text-13 text-accent-fg">
                创建
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg border border-board px-3 py-1.5 text-13 text-secondary"
              >
                取消
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-[14px]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setResults(null);
              }}
              className="text-muted transition-colors hover:text-primary"
              aria-label="返回"
            >
              <ArrowLeft size={16} />
            </button>
            <p className="text-15 font-semibold text-primary">{selected.name}</p>
          </div>

          <div className="rounded-xl border border-board bg-card-ivory p-4">
            <div className="flex items-center justify-between">
              <p className="text-13 font-medium text-secondary">文档（{items.length}）</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void addDirectory()}
                  className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 text-secondary transition-colors hover:text-primary"
                >
                  <FolderPlus size={13} />
                  导入文件夹
                </button>
                <button
                  type="button"
                  onClick={() => void addFiles()}
                  className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 text-secondary transition-colors hover:text-primary"
                >
                  <FilePlus2 size={13} />
                  添加文档
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {items.length === 0 ? (
                <p className="py-2 text-12 text-muted">还没有文档。添加 md / txt / pdf / docx 后自动建立索引。</p>
              ) : (
                items.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 rounded-lg border border-board bg-card px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-13 text-primary">{it.name}</p>
                      {it.error && <p className="mt-0.5 truncate text-11 text-error">{it.error}</p>}
                    </div>
                    <span
                      className={
                        'shrink-0 rounded-full bg-chip px-2 py-0.5 text-11 ' +
                        (it.status === 'failed' ? 'text-error' : 'text-muted')
                      }
                    >
                      {STATUS_LABEL[it.status] ?? it.status} · {it.chunkCount} 块
                    </span>
                    {it.status === 'failed' && (
                      <button
                        type="button"
                        title="重试索引"
                        onClick={() => void retryItem(it)}
                        className="shrink-0 text-muted transition-colors hover:text-primary"
                      >
                        <RefreshCw size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      title="移除"
                      onClick={() => void removeItem(it)}
                      className="shrink-0 text-muted transition-colors hover:text-error"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-board bg-card-ivory p-4">
            <p className="text-13 font-medium text-secondary">检索测试</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
                placeholder="输入关键词试试召回效果"
                className={inputCls}
              />
              <select
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="h-9 shrink-0 rounded-lg border border-board bg-card px-2 text-13 text-primary outline-none"
                title="返回条数"
              >
                <option value={6}>6 条</option>
                <option value={8}>8 条</option>
                <option value={12}>12 条</option>
                <option value={20}>20 条</option>
              </select>
              <button
                type="button"
                onClick={runSearch}
                disabled={searching || !query.trim()}
                className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-accent px-3 text-13 text-accent-fg disabled:opacity-50"
              >
                <Search size={13} />
                {searching ? '检索中…' : '检索'}
              </button>
            </div>
            {results && (
              <div className="mt-3 flex flex-col gap-2">
                {results.length === 0 ? (
                  <p className="text-12 text-muted">没有检索到相关内容。换个更具体的关键词试试。</p>
                ) : (
                  results.map((r, i) => (
                    <div key={i} className="rounded-lg border border-board bg-card px-3 py-2">
                      <p className="text-11 text-muted">
                        {r.baseName} / {r.itemName} · 第 {r.seq + 1} 块
                      </p>
                      <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-12 text-secondary">{r.text}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
