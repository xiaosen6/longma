/**
 * 审批队列单测：登记/结算/重复结算/未知 id/permission 超时 deny/
 * 非 permission（plan_review）不超时/跨会话 list。
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { InteractionQueue, PERMISSION_INTERACTION_TIMEOUT_MS } from './interaction-queue.ts';

interface BroadcastCall {
  channel: string;
  payload: Record<string, unknown>;
}

function makeQueue(): { queue: InteractionQueue; calls: BroadcastCall[] } {
  const calls: BroadcastCall[] = [];
  const queue = new InteractionQueue((channel, payload) => {
    calls.push({ channel, payload: payload as Record<string, unknown> });
  });
  return { queue, calls };
}

const permReq = (requestId: string) => ({
  kind: 'permission' as const,
  requestId,
  toolName: 'bash',
  input: { command: 'ls' },
});

test('permission 登记→广播 REQUEST；结算 allow→resolve + 广播 DISMISSED(resolved)', async () => {
  const { queue, calls } = makeQueue();
  const p = queue.enqueue('s1', permReq('r1'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.channel, 'interaction:request');
  const ok = queue.settle('r1', { kind: 'permission', behavior: 'allow' });
  assert.equal(ok, true);
  assert.deepEqual(
    await p,
    { kind: 'permission', behavior: 'allow' },
  );
  const dismissed = calls.find((c) => c.channel === 'interaction:dismissed');
  assert.ok(dismissed);
  assert.equal(dismissed.payload['reason'], 'resolved');
});

test('重复结算与未知 requestId 返回 false', async () => {
  const { queue } = makeQueue();
  const p = queue.enqueue('s1', permReq('r1'));
  assert.equal(queue.settle('r1', { kind: 'permission', behavior: 'deny' }), true);
  assert.equal(queue.settle('r1', { kind: 'permission', behavior: 'allow' }), false);
  assert.equal(queue.settle('nope', { kind: 'permission', behavior: 'allow' }), false);
  assert.deepEqual(await p, { kind: 'permission', behavior: 'deny' });
});

test('permission 10 分钟超时：自动 deny + 广播 DISMISSED(timeout)，之后结算返回 false', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { queue, calls } = makeQueue();
    const p = queue.enqueue('s1', permReq('r1'));
    let settled: unknown = 'unsettled';
    void p.then((d) => { settled = d; });
    mock.timers.tick(PERMISSION_INTERACTION_TIMEOUT_MS - 1);
    assert.equal(settled, 'unsettled', '未到 10 分钟不应超时');
    mock.timers.tick(1);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(settled, { kind: 'permission', behavior: 'deny', reason: '审批超时自动拒绝' });
    const dismissed = calls.find((c) => c.channel === 'interaction:dismissed');
    assert.ok(dismissed);
    assert.equal(dismissed.payload['reason'], 'timeout');
    assert.equal(queue.settle('r1', { kind: 'permission', behavior: 'allow' }), false);
  } finally {
    mock.timers.reset();
  }
});

test('plan_review 不设超时（不会自动 deny）', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { queue } = makeQueue();
    const p = queue.enqueue('s1', { kind: 'plan_review', requestId: 'r2', plan: '步骤…' });
    mock.timers.tick(PERMISSION_INTERACTION_TIMEOUT_MS * 10);
    const state = await Promise.race([
      p.then(() => 'settled' as const),
      new Promise<'pending'>((r) => setImmediate(() => r('pending'))),
    ]);
    assert.equal(state, 'pending', 'plan_review 不应被超时自动结算');
    queue.settle('r2', { kind: 'plan_review', behavior: 'allow' });
  } finally {
    mock.timers.reset();
  }
});

test('list() 列跨会话待决；结算后移除', async () => {
  const { queue } = makeQueue();
  void queue.enqueue('s1', permReq('r1'));
  void queue.enqueue('s2', permReq('r2'));
  const before = queue.list();
  assert.equal(before.length, 2);
  assert.deepEqual(before.map((x) => x.sessionId).sort(), ['s1', 's2']);
  queue.settle('r1', { kind: 'permission', behavior: 'deny' });
  assert.equal(queue.list().length, 1);
  assert.equal(queue.list()[0]!.sessionId, 's2');
  queue.settle('r2', { kind: 'permission', behavior: 'deny' });
  assert.equal(queue.list().length, 0);
});
