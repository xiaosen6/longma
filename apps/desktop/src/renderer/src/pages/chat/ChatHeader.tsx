import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { SessionRenameInput } from '../../components/SessionRenameInput';
import { hasFramelessControls } from '../../components/WindowControls';
import { cn } from '../../lib/cn';

/**
 * 会话主区 slim 头部（46px + 1px Board 发丝，对齐 Cindy ContentHeader：标题，
 * 不是用量环）。重命名状态内聚于此；提交/取消经 onRename 上抛。
 */
export function ChatHeader(props: {
  sessionId: string;
  title: string;
  workDir: string | null;
  /** 返回 reject 时由调用方落 notice；resolve（含未变更）表示完成 */
  onRename: (title: string) => Promise<void>;
}): React.JSX.Element {
  const { sessionId, title, workDir, onRename } = props;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  // 双击/铅笔两条入口与 commit/cancel 都可能触发状态切换；用 ref 防重复提交
  const committedRef = useRef(false);

  // 切会话：退出重命名态
  useEffect(() => {
    setRenaming(false);
    committedRef.current = false;
  }, [sessionId]);

  const beginRename = (): void => {
    committedRef.current = false;
    setDraft(title || '会话');
    setRenaming(true);
  };

  return (
    <header
      className={cn(
        'relative flex h-[46px] shrink-0 items-center justify-between gap-3 border-b border-board px-4 select-none',
        hasFramelessControls() && 'pr-[150px]',
      )}
    >
      {/* 拖拽层铺底、在窗口按钮左侧截止：悬浮 no-drag 挖洞在 Electron 37
          /Windows 上对真实鼠标不可靠，干脆不与按钮区重叠 */}
      <div
        aria-hidden
        className={cn(
          'drag-region absolute inset-y-0 left-0',
          hasFramelessControls() ? 'right-[150px]' : 'right-0',
        )}
      />
      <div className="no-drag group/title relative flex min-w-0 flex-1 items-center gap-1">
        {renaming ? (
          <SessionRenameInput
            value={draft}
            onChange={setDraft}
            onCommit={(raw) => {
              if (committedRef.current) return;
              committedRef.current = true;
              setRenaming(false);
              const trimmed = raw.replace(/\s+/g, ' ').trim();
              if (!trimmed || trimmed === title) return;
              void onRename(trimmed);
            }}
            onCancel={() => {
              committedRef.current = true;
              setRenaming(false);
            }}
            className="max-w-[min(420px,70%)]"
          />
        ) : (
          <>
            <button
              type="button"
              className="min-w-0 truncate text-left text-14 font-medium text-primary"
              title="双击重命名"
              onDoubleClick={beginRename}
            >
              {title || '会话'}
            </button>
            <button
              type="button"
              title="重命名"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 hover:bg-hover hover:text-primary group-hover/title:opacity-100 focus-visible:opacity-100"
              onClick={beginRename}
            >
              <Pencil size={13} />
            </button>
            {workDir ? (
              <span className="ml-1 min-w-0 truncate font-normal text-12 text-muted" title={workDir}>
                {workDir.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')}
              </span>
            ) : null}
          </>
        )}
      </div>
    </header>
  );
}
