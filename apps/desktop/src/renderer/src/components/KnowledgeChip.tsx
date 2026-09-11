/**
 * 知识库注入 chip（composer 工具行）：选择一个知识库后，发送时自动检索该库
 * 并把原文片段注入模型消息（强制 RAG，不依赖模型自主调工具）。
 */
import { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { MorphPopover } from './ui/MorphPopover';
import type { KnowledgeBaseView } from '../../../shared/fundet-api.ts';

interface KnowledgeChipProps {
  selectedBaseId: string | null;
  onSelect: (baseId: string | null) => void;
}

export function KnowledgeChip({ selectedBaseId, onSelect }: KnowledgeChipProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [bases, setBases] = useState<KnowledgeBaseView[]>([]);

  useEffect(() => {
    if (!open) return;
    void window.fundet
      .listKnowledgeBases()
      .then((list) => setBases(list.filter((b) => b.fileCount > 0)))
      .catch(() => undefined);
  }, [open]);

  const selected = bases.find((b) => b.id === selectedBaseId) ?? null;
  const label = selected ? selected.name : '知识库';

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      title={selected ? `回答时自动检索「${selected.name}」` : '开启后回答时自动检索所选知识库'}
      className={cn(
        'inline-flex h-[30px] max-w-full items-center gap-2 rounded-full border px-2.5 text-13 transition-colors select-none',
        selectedBaseId
          ? 'border-board bg-composer-pill text-primary'
          : 'border-transparent bg-transparent text-secondary hover:border-board hover:bg-composer-pill',
      )}
    >
      <BookOpen size={14} className="shrink-0" />
      <span className="min-w-0 max-w-[160px] truncate">{label}</span>
      {selected ? (
        <X
          size={12}
          className="shrink-0 text-muted hover:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(null);
          }}
        />
      ) : (
        <ChevronDown size={14} className="shrink-0 text-muted" />
      )}
    </button>
  );

  return (
    <MorphPopover
      open={open}
      onOpenChange={setOpen}
      panelWidth={300}
      panelClassName="p-2"
      panelAriaLabel="选择知识库"
      wrapperClassName="shrink-0"
      trigger={trigger}
    >
      <div className="flex flex-col">
        {selectedBaseId && (
          <>
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-inner px-3 py-[10px] text-left hover:bg-menu-item-hover"
            >
              <X size={18} className="shrink-0 text-muted" />
              <span className="text-14 font-medium text-primary">不使用知识库</span>
            </button>
            <div className="mx-2 my-1 h-px bg-board" />
          </>
        )}
        {bases.length === 0 ? (
          <div className="px-3 py-2 text-12 text-muted">
            还没有可用的知识库。到「设置 → 知识库」新建并导入文档。
          </div>
        ) : (
          <div className="flex flex-col">
            {bases.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  onSelect(b.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-inner px-3 py-[10px] text-left hover:bg-menu-item-hover',
                  b.id === selectedBaseId && 'bg-menu-item-hover',
                )}
              >
                <BookOpen size={18} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-14 font-medium text-primary">{b.name}</span>
                  <span className="block truncate text-12 text-muted">
                    {b.fileCount} 个文件 · {b.chunkCount} 块
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </MorphPopover>
  );
}
