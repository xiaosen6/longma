/**
 * BrowserSection — 设置 → 通用「浏览器自动化」分区。
 * 开关默认关：开启后**新开会话**注入浏览器工具（mcp__browser__*），托管浏览器
 * 的登录态长期保留。审批不进白名单，跟会话权限三档走。
 */
import { useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';

export function BrowserSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.fundet
      .browserStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => undefined);
  }, []);

  const toggle = (next: boolean): void => {
    setEnabled(next);
    setError('');
    void window.fundet.setBrowserEnabled(next).catch((err) => {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  const open = async (): Promise<void> => {
    setOpening(true);
    setError('');
    try {
      await window.fundet.openBrowserForLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="rounded-xl border border-board bg-card-ivory p-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-13 font-medium text-secondary">浏览器自动化</p>
          <p className="mt-1 text-12 leading-[1.5] text-muted">
            开启后，新会话里助手可以操作一个专用的托管浏览器（读取网页正文、点击、填表）。
            登录网站请在专用浏览器里进行，登录态会一直保留。默认每次询问，可在会话里切「自动」。
          </p>
        </div>
        <Switch.Root
          checked={enabled}
          onCheckedChange={toggle}
          className="h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full bg-chip data-[state=checked]:bg-accent"
        >
          <Switch.Thumb className="block h-[16px] w-[16px] translate-x-[2px] rounded-full bg-card transition-transform data-[state=checked]:translate-x-[18px]" />
        </Switch.Root>
      </div>
      {enabled && (
        <div className="mt-3 flex items-center gap-3 border-t border-board pt-3">
          <button
            type="button"
            onClick={() => void open()}
            disabled={opening}
            className="rounded-full border border-board bg-chip px-3 py-1.5 text-13 text-primary transition-colors hover:bg-hover disabled:opacity-50"
          >
            {opening ? '正在打开…' : '打开托管浏览器'}
          </button>
          <span className="text-12 text-muted">需要登录某个网站时先在这里打开并登录</span>
        </div>
      )}
      {error && <p className="mt-2 text-12 text-error">{error}</p>}
    </div>
  );
}
