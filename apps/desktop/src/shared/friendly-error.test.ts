import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError, friendlyProviderError } from './friendly-error.ts';

test('friendly provider error', async (t) => {
  await t.test('智谱 1210 content.type 只支持 text → 图片输入引导', () => {
    const raw = '400: {"code":"1210","message":"messages.content.type 参数非法，取值范围 [\'text\']"}';
    const out = friendlyProviderError(raw);
    assert.match(out, /不支持图片输入/);
    assert.match(out, /视觉/);
  });

  await t.test('max_tokens 超限 → 引导调小 maxTokens', () => {
    const raw = '400: {"code":"1210","message":"max_tokens参数非法：限制数值范围[1,1024]"}';
    assert.match(friendlyProviderError(raw), /maxTokens/);
  });

  await t.test('供应商 401 走安全分类给中文行动项（②升级后行为）', () => {
    const msg = friendlyProviderError('401: unauthorized');
    assert.ok(msg.includes('API Key'));
    assert.ok(msg.includes('设置 → 模型供应商'));
  });
  await t.test('真正无关的错误原样返回', () => {
    assert.equal(friendlyProviderError('某个奇怪的未知错误'), '某个奇怪的未知错误');
  });
});

test('pi 进程退出码映射', async (t) => {
  await t.test('0xC000001D（3221225501）→ AVX2 引导', () => {
    const out = friendlyError('pi process exited (code=3221225501, signal=null)');
    assert.match(out, /AVX2/);
    assert.match(out, /3221225501/);
  });
  await t.test('unexpected 变体也命中', () => {
    assert.match(
      friendlyError('pi process exited unexpectedly (code=3221225501, signal=null)'),
      /AVX2/,
    );
  });
  await t.test('DLL 缺失 / 访问违例', () => {
    assert.match(friendlyError('pi process exited (code=3221225781, signal=null)'), /杀毒|组件/);
    assert.match(friendlyError('pi process exited (code=3221225477, signal=null)'), /重装|杀毒/);
  });
  await t.test('未知退出码保留原文并引导反馈', () => {
    assert.match(friendlyError('pi process exited (code=1, signal=null)'), /退出码 1/);
  });
});
