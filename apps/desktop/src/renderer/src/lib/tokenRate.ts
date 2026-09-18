/**
 * token 输出速度采样（对齐 Cindy runningTokenRateHistory 的规则，挂钟适配版）。
 *
 * Cindy 用 agent-core 的 generationDurationMs（只计生成区间）；LongMa 的 pi
 * translator 只在 done 事件透出时长，流中无连续时长源——用事件到达挂钟近似。
 * 防 #4351 三类放大的规则原样保留：
 *  - <1s 窗口只计数不采样（毫秒级用量批次不是吞吐测量）；
 *  - token 数未变的上报只刷 lastReport 不关区间（token 可能批量后到）；
 *  - 峰值只由完整 ≥1s 窗口更新；计数倒退/新轮 → 清基线保留 samples/peak。
 */
import { useSyncExternalStore } from 'react';

export interface RateSample {
  /** 距本轮开始的毫秒 */
  t: number;
  tokens: number;
  /** tok/s */
  rate: number;
}

export interface RateHistory {
  running: boolean;
  /** 本轮开始时间（挂钟 ms，用于把样本时间归零） */
  turnStart: number | null;
  baseline: { t: number; tokens: number } | null;
  lastReport: { t: number; tokens: number } | null;
  totalTokens: number;
  samples: RateSample[];
  peak: number;
}

export const MAX_RATE_SAMPLES = 60;
const MIN_SAMPLE_WINDOW_MS = 1000;

export function emptyRateHistory(): RateHistory {
  return {
    running: false,
    turnStart: null,
    baseline: null,
    lastReport: null,
    totalTokens: 0,
    samples: [],
    peak: 0,
  };
}

export function latestRate(history: RateHistory): number | null {
  const last = history.samples[history.samples.length - 1];
  return last ? last.rate : null;
}

export function averageRate(history: RateHistory): number | null {
  if (history.turnStart == null || history.lastReport == null) return null;
  const span = history.lastReport.t - history.turnStart;
  if (span < MIN_SAMPLE_WINDOW_MS || history.lastReport.tokens <= 0) return null;
  return (history.lastReport.tokens * 1000) / span;
}

export function recordRateReport(
  history: RateHistory,
  input: { now: number; outputTokens: number; running: boolean },
): RateHistory {
  const { now, outputTokens, running } = input;
  if (!Number.isFinite(outputTokens) || outputTokens < 0) return history;

  // 新轮开始（false→true 或 running 中计数倒退=轮重置）：清基线三件套，保留历史样本
  const isNewTurn =
    (running && !history.running) ||
    (history.lastReport != null && outputTokens < history.lastReport.tokens);
  if (isNewTurn) {
    return {
      running,
      turnStart: now,
      baseline: { t: now, tokens: outputTokens },
      lastReport: { t: now, tokens: outputTokens },
      totalTokens: outputTokens,
      samples: history.samples,
      peak: history.peak,
    };
  }

  const turnStart = history.turnStart ?? now;
  const last = history.lastReport ?? { t: now, tokens: outputTokens };

  // 与上次完全相同 → 原样（保留 running 语义即可）
  if (last.t !== now && last.tokens === outputTokens && history.baseline != null) {
    // token 未变的上报：只刷 lastReport 时间，不关区间（防时间先到 token 后到）
    return { ...history, running, turnStart, lastReport: { t: now, tokens: outputTokens } };
  }
  if (last.tokens === outputTokens && last.t === now && history.baseline != null) {
    return { ...history, running, turnStart };
  }

  // 无基线（中途打开）：只记基线，不把累计均值当最近速度
  if (history.baseline == null) {
    return {
      running,
      turnStart,
      baseline: { t: now, tokens: outputTokens },
      lastReport: { t: now, tokens: outputTokens },
      totalTokens: outputTokens,
      samples: history.samples,
      peak: history.peak,
    };
  }

  const dt = now - history.baseline.t;
  const dTokens = outputTokens - history.baseline.tokens;
  const next: RateHistory = {
    running,
    turnStart,
    baseline: history.baseline,
    lastReport: { t: now, tokens: outputTokens },
    totalTokens: outputTokens,
    samples: history.samples,
    peak: history.peak,
  };

  if (dt >= MIN_SAMPLE_WINDOW_MS && dTokens >= 0) {
    const rate = (dTokens * 1000) / dt;
    const samples = [...history.samples, { t: now - turnStart, tokens: outputTokens, rate }];
    if (samples.length > MAX_RATE_SAMPLES) samples.shift();
    next.samples = samples;
    next.peak = Math.max(history.peak, rate);
    next.baseline = { t: now, tokens: outputTokens };
  }

  // 轮结束：清基线（空闲恢复不能用旧轮基线 diff 出虚假速率），保留 samples/peak
  if (!running) {
    next.baseline = null;
    next.turnStart = null;
  }
  return next;
}
