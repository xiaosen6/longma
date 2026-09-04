/**
 * PetSection — 设置 → 自动操作「桌宠」分区。
 * 开关：显示/隐藏桌面宠物窗；形象：black-heels（黑高跟少女）/ qipao（旗袍少女）。
 * 状态与主题持久化在主进程（pet-window.json），窗口关闭重开自动还原。
 */
import { useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';

const THEMES: Array<{ id: string; label: string }> = [
  { id: 'black-heels', label: '黑高跟少女' },
  { id: 'qipao', label: '旗袍少女' },
];

export function PetSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [theme, setTheme] = useState('black-heels');

  useEffect(() => {
    void window.fundet
      .petGetState()
      .then((s) => {
        setEnabled(s.enabled);
        setTheme(s.theme);
      })
      .catch(() => undefined);
  }, []);

  const toggle = (next: boolean): void => {
    setEnabled(next);
    void window.fundet.petToggle().catch(() => setEnabled(!next));
  };

  const pickTheme = (id: string): void => {
    setTheme(id);
    void window.fundet.petSetTheme(id).catch(() => undefined);
  };

  return (
    <div className="rounded-xl border border-board bg-card-ivory p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-13 font-medium text-secondary">桌宠</p>
          <p className="mt-1 text-12 leading-[1.5] text-muted">
            桌面右下角的像素小伙伴，实时反映助手状态（思考 / 工作中 / 等待审批 / 睡觉）。
            单击打开主窗口，按住可拖动。
          </p>
        </div>
        <Switch.Root
          checked={enabled}
          onCheckedChange={toggle}
          className="relative h-[22px] w-[42px] shrink-0 cursor-pointer rounded-full border border-board bg-card transition-colors data-[state=checked]:bg-[var(--accent,#2563eb)]"
        >
          <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[22px]" />
        </Switch.Root>
      </div>
      {enabled && (
        <div className="mt-3 border-t border-board pt-3">
          <p className="text-12 text-secondary">形象</p>
          <div className="mt-2 flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTheme(t.id)}
                className={
                  'rounded-full border px-3 py-1 text-12 transition-colors ' +
                  (theme === t.id
                    ? 'border-[var(--accent,#2563eb)] bg-[var(--accent,#2563eb)]/10 text-primary'
                    : 'border-board text-secondary hover:text-primary')
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
