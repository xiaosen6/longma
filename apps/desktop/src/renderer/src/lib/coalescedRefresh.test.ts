import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCoalescedRefresh } from './coalescedRefresh.ts';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** 一次性闸门：第一读挂起等待放行，放行后的后续读直接通过 */
function makeGate(): { gate: () => Promise<void>; open: () => void } {
  let opened = false;
  let release: (() => void) | undefined;
  const gate = (): Promise<void> => {
    if (opened) return Promise.resolve();
    return new Promise((r) => {
      release = r;
    });
  };
  const open = (): void => {
    opened = true;
    release?.();
  };
  return { gate, open };
}

describe('createCoalescedRefresh（移植 Cindy #4602）', () => {
  it('并发调用共享同一次在飞读', async () => {
    const refresh = createCoalescedRefresh<number>();
    let reads = 0;
    const read = async (): Promise<number> => {
      reads += 1;
      await tick();
      return 42;
    };
    const [a, b, c] = await Promise.all([refresh(read), refresh(read), refresh(read)]);
    assert.equal(reads, 1);
    assert.deepEqual([a, b, c], [42, 42, 42]);
  });

  it('在飞期间再次失效：完成后立刻补读一次，共享结果取最新', async () => {
    const refresh = createCoalescedRefresh<number>();
    let reads = 0;
    let value = 1;
    const { gate, open } = makeGate();
    const read = async (): Promise<number> => {
      const v = value;
      reads += 1;
      await gate();
      return v;
    };
    const first = refresh(read);
    await tick(); // 让第一读真正在飞（已捕获 value=1）
    value = 2;
    refresh(read); // 在飞期间失效 → 尾部合并补读
    open();
    assert.equal(await first, 2); // 同批调用方共享同一 active promise，都拿补读结果
    assert.equal(reads, 2);
  });

  it('无后续失效时错误向上抛', async () => {
    const refresh = createCoalescedRefresh<number>();
    const read = async (): Promise<number> => {
      await tick();
      throw new Error('boom');
    };
    await assert.rejects(refresh(read), /boom/);
  });

  it('在飞失败但有尾部读：失败被吸收，同批调用方共享补读结果', async () => {
    const refresh = createCoalescedRefresh<number>();
    let calls = 0;
    const { gate, open } = makeGate();
    const read = async (): Promise<number> => {
      calls += 1;
      const failed = calls === 1;
      await gate();
      if (failed) throw new Error('transient');
      return 7;
    };
    const first = refresh(read);
    await tick(); // 第一读在飞且将失败
    const second = refresh(read); // latest 已就位 → 失败后补读
    open();
    assert.equal(await first, 7);
    assert.equal(await second, 7);
    assert.equal(calls, 2);
  });
});
