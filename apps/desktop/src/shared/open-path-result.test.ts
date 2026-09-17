import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyIpcLifecycle } from './open-path-result.ts';

describe('classifyIpcLifecycle（IPC 生命周期失败归一化，移植 Cindy #4404）', () => {
  it('识别两类生命周期 rejection 文案', () => {
    assert.equal(classifyIpcLifecycle('reply was never sent'), 'ipc_lifecycle');
    assert.equal(classifyIpcLifecycle('reply was never sent.'), 'ipc_lifecycle');
    assert.equal(classifyIpcLifecycle('Render frame was disposed'), 'ipc_lifecycle');
    assert.equal(
      classifyIpcLifecycle('Render frame was disposed before WebFrameMain could be accessed.'),
      'ipc_lifecycle',
    );
  });

  it('真实错误/版本偏差不归入生命周期', () => {
    assert.equal(classifyIpcLifecycle("No handler registered for 'fundet:fs:open-path'"), undefined);
    assert.equal(classifyIpcLifecycle('系统找不到指定的文件'), undefined);
    assert.equal(classifyIpcLifecycle(''), undefined);
  });
});
