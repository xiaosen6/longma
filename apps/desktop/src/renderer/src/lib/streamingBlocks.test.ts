/** 流式块切分单测：段落边界 / 围栏保护 / 生长稳定性 / 空文本。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitStreamingBlocks } from './streamingBlocks.ts';

test('空行切分段落，最后一块 unstable 其余 stable', () => {
  const blocks = splitStreamingBlocks('第一段\n\n第二段\n\n第三段还在长');
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.text), ['第一段', '第二段', '第三段还在长']);
  assert.deepEqual(blocks.map((b) => b.stable), [true, true, false]);
  assert.deepEqual(blocks.map((b) => b.key), ['b0', 'b1', 'b2']);
});

test('代码围栏内的空行不切分', () => {
  const blocks = splitStreamingBlocks('说明\n\n```\ncode\n\nmore\n```\n\n结尾');
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1]!.text, '```\ncode\n\nmore\n```');
});

test('未闭合围栏整体一块（生长中）', () => {
  const blocks = splitStreamingBlocks('前文\n\n```ts\nconst a = 1;');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1]!.text, '```ts\nconst a = 1;');
  assert.equal(blocks[1]!.stable, false);
});

test('生长稳定性：尾部追加新块，前块 key 与 text 不变', () => {
  const before = splitStreamingBlocks('A\n\nB');
  const after = splitStreamingBlocks('A\n\nB\n\nC');
  // B 从 unstable 毕业为 stable，但 key/text 不变 → memo 不重渲染
  assert.equal(before[1]!.key, after[1]!.key);
  assert.equal(before[1]!.text, after[1]!.text);
  assert.equal(after[2]!.text, 'C');
});

test('尾块自身生长也保持 key', () => {
  const before = splitStreamingBlocks('A\n\nB1');
  const after = splitStreamingBlocks('A\n\nB12');
  assert.equal(before[1]!.key, after[1]!.key);
  assert.equal(after[1]!.text, 'B12');
});

test('连续空行只切一次；空文本返回空数组', () => {
  assert.equal(splitStreamingBlocks('A\n\n\n\nB').length, 2);
  assert.deepEqual(splitStreamingBlocks(''), []);
  assert.deepEqual(splitStreamingBlocks('\n\n\n'), []);
});

test('波浪线围栏同样受保护', () => {
  const blocks = splitStreamingBlocks('~~~\na\n\nb\n~~~');
  assert.equal(blocks.length, 1);
});
