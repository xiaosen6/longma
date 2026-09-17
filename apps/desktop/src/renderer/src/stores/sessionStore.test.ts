import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { __testHooks } from './sessionStore.ts';

/**
 * isFinal 双行回归（对照 Cindy #4375 的病灶形态）：Cindy 的 main 落库层在
 * 「交互边界 flush 部分文本成行 + isFinal 全文快照另起一行」时产生同段正文两行。
 * LongMa 渲染层结构上免疫——流式文本只存在于 streamingText（不成行），isFinal
 * 才封口成唯一 assistant 条目；交互请求走独立通道不进 items。本测试钉住这个
 * 契约，防未来改动（如加流式落行）引入同款双行。
 */

const sid = `test-isfinal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe('sessionStore isFinal 封口契约（Cindy #4375 回归锚）', () => {
  it('delta→thinking→isFinal→done 全序列只落一条 assistant', () => {
    const { applyEvent, getSlice } = __testHooks;
    applyEvent(sid, { type: 'text', data: { text: '你' } });
    applyEvent(sid, { type: 'text', data: { text: '好' } });
    applyEvent(sid, { type: 'thinking', data: { stage: 'start', blockId: 'b1' } });
    applyEvent(sid, { type: 'thinking', data: { stage: 'delta', blockId: 'b1', text: '思考中' } });
    applyEvent(sid, { type: 'thinking', data: { stage: 'final', blockId: 'b1', text: '思考完成', durationMs: 120 } });
    applyEvent(sid, { type: 'tool_use', data: { toolUseId: 't1', toolName: 'read', input: { path: 'a.ts' } } });
    applyEvent(sid, { type: 'tool_result', data: { toolUseIds: ['t1'], summary: 'ok' } });
    applyEvent(sid, { type: 'text', data: { text: '你好，世界', isFinal: true } });
    applyEvent(sid, { type: 'done', data: { result: '你好，世界', usage: { tokenUsage: 10, contextTokens: 5, costUsd: 0 } } });

    const s = getSlice(sid);
    const assistants = s.items.filter((it) => it.kind === 'assistant');
    assert.equal(assistants.length, 1);
    assert.equal((assistants[0] as { text: string }).text, '你好，世界');
    assert.equal(s.streamingText, '');
    assert.equal(s.isRunning, false);
  });

  it('无 isFinal 的残留流式文本由 done 兜底封口,也只一条 assistant', () => {
    const sid2 = `${sid}-b`;
    const { applyEvent, getSlice } = __testHooks;
    applyEvent(sid2, { type: 'text', data: { text: '部分正文' } });
    applyEvent(sid2, { type: 'done', data: { result: '部分正文' } });
    const s = getSlice(sid2);
    assert.equal(s.items.filter((it) => it.kind === 'assistant').length, 1);
    assert.equal(s.streamingText, '');
  });
});
