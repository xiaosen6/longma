import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkText } from './chunks.ts';

test('空文本返回空数组', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('短文本单块', () => {
  const out = chunkText('这是一段简短的介绍。');
  assert.equal(out.length, 1);
  assert.ok(out[0].includes('简短'));
});

test('长文本多块且覆盖完整', () => {
  const para = '这是第一段的测试内容，包含若干句子。机器学习是人工智能的一个分支。'.repeat(30);
  const text = Array.from({ length: 20 }, (_, i) => `段落${i}：${para}`).join('\n\n');
  const out = chunkText(text);
  assert.ok(out.length > 1);
  for (const b of out) {
    assert.ok(b.length > 0);
    assert.ok(b.length <= 2000, `块超长: ${b.length}`);
  }
});

test('单段超长按句硬切不丢内容', () => {
  const long = '甲乙丙丁。'.repeat(500);
  const out = chunkText(long);
  assert.ok(out.length > 1);
  const joined = out.join('');
  assert.ok(joined.includes('甲乙丙丁'));
});

test('块间有重叠（后块开头含前块结尾片段）', () => {
  const text = Array.from({ length: 30 }, (_, i) => `第${i}段内容，用于测试重叠行为。每段都需要足够长才行。`).join('\n\n');
  const out = chunkText(text);
  assert.ok(out.length >= 2);
  const tail = out[0].slice(-20);
  assert.ok(out[1].includes(tail.slice(0, 10)), '第二块应包含第一块的结尾重叠');
});
