/**
 * TokenRateChip —— 输入卡下方行右侧的 token 速度 chip + 历史浮窗
 * （对齐 Cindy RunningTokenRatePopover 的简化形态：chip 常驻、点击钉出面板；
 *  sparkline 纯 SVG 手画同款坐标）。
 */
import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { cn } from '../lib/cn';
import { MorphPopover } from './ui/MorphPopover';
import { averageRate, latestRate, type RateHistory } from '../lib/tokenRate';

function fmt(n: number): string {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1);
}

function Sparkline({ history }: { history: RateHistory }): React.JSX.Element {
  const samples = history.samples.slice(-60);
  if (samples.length === 0) {
    return <div className="flex h-12 items-center justify-center text-12 text-muted">本轮还没有完整采样窗口</div>;
  }
  const firstTime = samples[0]!.t;
  const lastTime = samples[samples.length - 1]!.t;
  const span = lastTime - firstTime;
  const ceiling = Math.max(1, ...samples.map((p) => p.rate));
  const points = samples.map((p) => ({
    x: 4 + (span === 0 ? 112 : ((p.t - firstTime) / span) * 108),
    y: 44 - (p.rate / ceiling) * 36,
  }));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L112,44 L${points[0]!.x.toFixed(1)},44 Z`;
  const last = points[points.length - 1]!;
  return (
    <svg viewBox="0 0 120 48" className="h-12 w-full" aria-hidden="true">
      <path d={area} fill="var(--accent)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx={last.x} cy={last.y} r="2.5" fill="var(--accent)" />
    </svg>
  );
}

function Cell({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex-1">
      <div className="text-12 font-medium tabular-nums text-primary">{value}</div>
      <div className="text-10 text-muted">{label}</div>
    </div>
  );
}

export function TokenRateChip({ history }: { history: RateHistory }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rate = latestRate(history);
  const avg = averageRate(history);
  const hasData = history.samples.length > 0 || history.running;
  if (!hasData) return null;

  const label = rate != null ? `${fmt(rate)} tok/s` : `${history.totalTokens} tok`;
  return (
    <MorphPopover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      panelWidth={264}
      trigger={
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="输出速度历史"
          className={cn(
            'flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-12 tabular-nums select-none',
            history.running ? 'font-medium text-secondary' : 'text-muted',
            'transition-colors hover:bg-hover active:scale-[0.98]',
          )}
          onClick={() => setOpen((v) => !v)}
        >
          <Gauge size={12} strokeWidth={1.8} />
          {label}
        </button>
      }
    >
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-13 font-medium text-primary">输出速度</span>
          <span className="text-12 tabular-nums text-muted">
            {history.running ? '进行中' : '已结束'}
          </span>
        </div>
        <Sparkline history={history} />
        <div className="flex gap-2">
          <Cell label="平均 tok/s" value={avg != null ? fmt(avg) : '—'} />
          <Cell label="输出总量" value={`${history.totalTokens}`} />
          <Cell label="峰值 tok/s" value={history.samples.length > 0 ? fmt(history.peak) : '—'} />
        </div>
      </div>
    </MorphPopover>
  );
}
