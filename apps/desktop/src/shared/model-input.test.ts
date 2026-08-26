import test from 'node:test';
import assert from 'node:assert/strict';
import { inferModelImageInput, effectiveModelInput } from './model-input.ts';

test('model image input inference', async (t) => {
  await t.test('已知视觉家族', () => {
    for (const id of [
      'glm-4v',
      'glm-4v-flash',
      'glm-4.5v',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-5',
      'o3-mini',
      'claude-sonnet-4-5',
      'gemini-2.5-pro',
      'qwen-vl-max',
      'deepseek-vl2',
      'doubao-1.5-vision-pro',
      'doubao-1.5-vision-lite',
      'doubao-seed-1-6-vision-250815',
      'gpt-4o-2024-11-20',
    ]) {
      assert.deepEqual(inferModelImageInput(id), ['text', 'image'], id);
    }
  });

  await t.test('纯文本模型不推断', () => {
    for (const id of ['deepseek-chat', 'deepseek-reasoner', 'glm-4', 'glm-4-air', 'glm-4.5', 'glm-4.6', 'glm-5.1', 'glm-5.3', 'qwen-max', 'kimi-k2', 'llama-3', 'doubao-1.5-pro-32k', 'doubao-seed-1-6-250615']) {
      assert.equal(inferModelImageInput(id), undefined, id);
    }
  });

  await t.test('显式库值优先于推断', () => {
    assert.deepEqual(effectiveModelInput('glm-4', ['text', 'image']), ['text', 'image']);
    // 显式关掉视觉的模型，即使 id 命中家族也保持纯文本
    assert.deepEqual(effectiveModelInput('glm-4v', ['text']), ['text']);
    // 缺省回落推断
    assert.deepEqual(effectiveModelInput('glm-4.5v', undefined), ['text', 'image']);
  });
});
