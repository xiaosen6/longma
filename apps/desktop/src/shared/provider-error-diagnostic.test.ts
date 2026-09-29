import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyProviderError,
  formatProviderErrorAction,
} from './provider-error-diagnostic.ts';

describe('classifyProviderError（Cindy #12c5f86ae 模式适配）', () => {
  it('HTTP 状态码 → 分类（401 认证/429 限流/5xx 服务商/4xx 拒绝）', () => {
    assert.equal(classifyProviderError('HTTP 401: unauthorized').category, 'authentication');
    assert.equal(classifyProviderError('HTTP 403 Forbidden').category, 'authentication');
    assert.equal(classifyProviderError('HTTP 429 too many requests').category, 'rate_limit');
    assert.equal(classifyProviderError('HTTP 502 bad gateway').category, 'provider_unavailable');
    assert.equal(classifyProviderError('HTTP 400 bad request').category, 'request_rejected');
    assert.equal(classifyProviderError('HTTP 402 payment required').category, 'permission');
  });

  it('成功握手状态（200/3xx）不提取——不进失败原因（Cindy #4ea75478f）', () => {
    const d = classifyProviderError('handshake ok HTTP 200 then stream broke');
    assert.equal(d.httpStatus, undefined);
    // 但文本线索仍可分类（stream broke → network）
    assert.equal(d.category, 'network');
  });

  it('无状态码的文本线索分类', () => {
    assert.equal(classifyProviderError('fetch failed: ECONNREFUSED 127.0.0.1').category, 'network');
    assert.equal(classifyProviderError('rate limit exceeded').category, 'rate_limit');
    assert.equal(classifyProviderError('余额不足，请充值').category, 'permission');
  });

  it('safeSummary 经脱敏（key 被替换）', () => {
    const d = classifyProviderError('HTTP 401: invalid key sk-abc123def456');
    assert.ok(!d.safeSummary.includes('sk-abc123def456'));
  });

  it('unknown 时保留原文（不走格式化）', () => {
    assert.equal(formatProviderErrorAction('random gibberish error'), 'random gibberish error');
  });

  it('确定类别给中文行动项+状态码后缀', () => {
    const msg = formatProviderErrorAction('HTTP 429: too many requests');
    assert.ok(msg.includes('限流'));
    assert.ok(msg.includes('HTTP 429'));
    assert.ok(msg.includes('等几秒'));
  });
});
