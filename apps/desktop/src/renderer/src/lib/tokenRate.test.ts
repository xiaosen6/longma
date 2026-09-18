import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  averageRate,
  emptyRateHistory,
  latestRate,
  recordRateReport,
} from './tokenRate.ts';

describe('tokenRate 采样器（对齐 Cindy #4351 规则）', () => {
  it('≥1s 窗口采样,<1s 只计数不采样', () => {
    let h = recordRateReport(emptyRateHistory(), { now: 1000, outputTokens: 0, running: true });
    h = recordRateReport(h, { now: 1400, outputTokens: 50, running: true }); // 400ms：不采样
    assert.equal(h.samples.length, 0);
    h = recordRateReport(h, { now: 2100, outputTokens: 200, running: true }); // 基线起 1100ms：采样
    assert.equal(h.samples.length, 1);
    assert.equal(h.samples[0]!.tokens, 200);
    assert.ok(Math.abs(h.samples[0]!.rate - (200 * 1000) / 1100) < 0.01);
    assert.ok(Math.abs(h.peak - (200 * 1000) / 1100) < 0.01);
  });

  it('token 未变的上报不关区间（时间先到 token 后到的补报不放大）', () => {
    let h = recordRateReport(emptyRateHistory(), { now: 0, outputTokens: 100, running: true });
    h = recordRateReport(h, { now: 2000, outputTokens: 100, running: true }); // 只有时间走
    assert.equal(h.samples.length, 0);
    // 之后 token 批量到：以基线（t=0, 100）计算,不被 2000 处的假区间污染
    h = recordRateReport(h, { now: 2600, outputTokens: 500, running: true });
    assert.equal(h.samples.length, 1);
    assert.ok(Math.abs(h.samples[0]!.rate - (400 * 1000) / 2600) < 0.01);
  });

  it('计数倒退（新轮）清基线保留 samples/peak', () => {
    let h = recordRateReport(emptyRateHistory(), { now: 0, outputTokens: 1000, running: true });
    h = recordRateReport(h, { now: 1500, outputTokens: 1300, running: true });
    assert.equal(h.samples.length, 1);
    h = recordRateReport(h, { now: 2000, outputTokens: 5, running: true }); // 新轮：tokens 倒退
    assert.equal(h.samples.length, 1); // 历史保留
    assert.ok(h.peak > 0);
    assert.equal(h.baseline!.tokens, 5); // 基线重置
    assert.equal(h.turnStart, 2000);
  });

  it('轮结束清基线;空闲后新轮重新起步且旧 peak 仍在', () => {
    let h = recordRateReport(emptyRateHistory(), { now: 0, outputTokens: 0, running: true });
    h = recordRateReport(h, { now: 1000, outputTokens: 100, running: true });
    h = recordRateReport(h, { now: 2000, outputTokens: 300, running: false });
    assert.equal(h.running, false);
    assert.equal(h.baseline, null);
    const peak = h.peak;
    h = recordRateReport(h, { now: 90_000, outputTokens: 10, running: true }); // 空闲后新轮
    assert.equal(h.samples.length, 2); // 旧样本保留
    assert.equal(h.peak, peak);
    assert.equal(h.turnStart, 90_000);
  });

  it('中途打开（无基线）只记基线不采样累计均值', () => {
    const h = recordRateReport(emptyRateHistory(), { now: 5000, outputTokens: 900, running: true });
    assert.equal(h.samples.length, 0);
    assert.equal(h.baseline!.tokens, 900);
    assert.equal(latestRate(h), null);
    assert.equal(averageRate(h), null);
  });

  it('latestRate/averageRate 基本计算', () => {
    let h = recordRateReport(emptyRateHistory(), { now: 0, outputTokens: 0, running: true });
    h = recordRateReport(h, { now: 1000, outputTokens: 100, running: true });
    h = recordRateReport(h, { now: 2000, outputTokens: 300, running: true });
    assert.ok(Math.abs(latestRate(h)! - 200) < 0.01);
    assert.ok(Math.abs(averageRate(h)! - 150) < 0.01);
  });
});
