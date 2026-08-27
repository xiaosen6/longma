/**
 * UsageCard — 新对话首页「近 30 天用量」：每日 token 柱状图（按模型堆叠），
 * 悬停 title 给逐模型明细。数据来自 main 侧 usage_daily 聚合（turn 增量累计）。
 * Cindy 同位置放首页仪表盘；这里做精简版：无数据时整卡不渲染。
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';

interface UsageDayRow {
  day: string;
  model: string;
  tokens: number;
  costUsd: number;
}

const WINDOW_DAYS = 30;
const CHART_HEIGHT = 72;
const PALETTE = ['#417CDD', '#EA6B17', '#3F9C6B', '#8B5CF6', '#D95565', '#0EA5A5', '#B7791F'];

function modelColor(model: string): string {
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function shortModel(model: string): string {
  return model.split('/').pop() ?? model;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + delta);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export function UsageCard(): React.JSX.Element | null {
  const [rows, setRows] = useState<UsageDayRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.fundet
      .usageHistory(WINDOW_DAYS)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const today = rows.reduce((a, r) => (r.day > a ? r.day : a), '');
    // 补齐 30 天空日
    const byDay = new Map<string, UsageDayRow[]>();
    for (const r of rows) {
      const list = byDay.get(r.day) ?? [];
      list.push(r);
      byDay.set(r.day, list);
    }
    const days: Array<{ day: string; tokens: number; costUsd: number; models: Map<string, number> }> = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const day = shiftDay(today, -i);
      const list = byDay.get(day) ?? [];
      const models = new Map<string, number>();
      let tokens = 0;
      let costUsd = 0;
      for (const r of list) {
        models.set(r.model, (models.get(r.model) ?? 0) + r.tokens);
        tokens += r.tokens;
        costUsd += r.costUsd;
      }
      days.push({ day, tokens, costUsd, models });
    }
    const maxTokens = Math.max(...days.map((d) => d.tokens), 1);
    const totalTokens = days.reduce((a, d) => a + d.tokens, 0);
    const totalCost = days.reduce((a, d) => a + d.costUsd, 0);
    const todayTokens = days[days.length - 1]?.tokens ?? 0;
    if (totalTokens <= 0) return null;
    return { days, maxTokens, totalTokens, totalCost, todayTokens };
  }, [rows]);

  if (!view) return null;

  return (
    <div className="w-full rounded-xl border border-board bg-card-ivory p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-1.5 text-13 font-medium text-secondary">
          <Activity size={13} />
          近 30 天用量
        </p>
        <p className="text-12 text-muted">
          今日 {fmtTokens(view.todayTokens)} tokens
          {view.totalCost > 0 && <> · 合计约 ${view.totalCost.toFixed(2)}</>}
        </p>
      </div>
      <div className="mt-3 flex h-[72px] items-end gap-[3px]" aria-label="近 30 天每日用量">
        {view.days.map((d) => {
          const h = Math.round((d.tokens / view.maxTokens) * CHART_HEIGHT);
          const detail = [...d.models.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([m, t]) => `${shortModel(m)} ${fmtTokens(t)}`)
            .join('，');
          return (
            <div
              key={d.day}
              className="flex min-w-0 flex-1 flex-col justify-end"
              style={{ height: CHART_HEIGHT }}
              title={`${d.day} · ${fmtTokens(d.tokens)} tokens${detail ? `（${detail}）` : ''}`}
            >
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-[2px]" style={{ height: Math.max(h, d.tokens > 0 ? 2 : 0) }}>
                {[...d.models.entries()].map(([m, t]) => (
                  <div
                    key={m}
                    style={{
                      height: `${(t / d.tokens) * 100}%`,
                      backgroundColor: modelColor(m),
                      opacity: 0.85,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
