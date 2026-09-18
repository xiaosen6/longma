/**
 * ToastContainer —— 右下角通知堆栈（lib/toast 的渲染面）。
 * 进入 float-in（150ms）；退出原地淡出（纸感：不缩放不被吸走）；
 * 手动关闭仅错误类常驻时需要。z-index 在 WindowControls(50) 之下、弹层之上。
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { dismissToast, useToasts } from '../lib/toast';

export function ToastContainer(): React.JSX.Element | null {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[300px] flex-col gap-2">
      {toasts.map((t) => (
        <ToastRow key={t.id} id={t.id} kind={t.kind} text={t.text} dismissible={t.duration === 0} />
      ))}
    </div>
  );
}

function ToastRow({ id, kind, text, dismissible }: { id: number; kind: string; text: string; dismissible: boolean }): React.JSX.Element {
  const [leaving, setLeaving] = useState(false);
  return (
    <div
      className={cn(
        'animate-float-in pointer-events-auto flex items-start gap-2 rounded-container border px-3 py-2 shadow-[var(--shadow-menu)]',
        kind === 'error' ? 'border-error-border bg-error-bg' : 'border-board bg-card',
        leaving && 'transition-opacity duration-150 opacity-0',
      )}
    >
      <span className={cn('min-w-0 flex-1 text-13 leading-snug break-words', kind === 'error' ? 'text-error' : 'text-primary')}>
        {text}
      </span>
      {dismissible && (
        <button
          type="button"
          aria-label="关闭"
          className="mt-[1px] shrink-0 text-muted hover:text-primary"
          onClick={() => {
            setLeaving(true);
            setTimeout(() => dismissToast(id), 150);
          }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
