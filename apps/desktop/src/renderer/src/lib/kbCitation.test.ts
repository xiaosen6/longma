/** 知识库引用角标单测：编号替换边界 + href 解析。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKbCitations, parseKbCiteHref } from './kbCitation.ts';

test('编号在范围内替换为角标链接', () => {
  assert.equal(
    normalizeKbCitations('睡眠对记忆很重要[1]，另有研究[2]支持。', 2),
    '睡眠对记忆很重要[1](#kb-1)，另有研究[2](#kb-2)支持。',
  );
});

test('越界编号与普通方括号原样保留', () => {
  assert.equal(
    normalizeKbCitations('见[3]与[0]和[abc]以及[]', 2),
    '见[3]与[0]和[abc]以及[]',
  );
});

test('refCount=0 或无方括号零成本返回', () => {
  assert.equal(normalizeKbCitations('[1] 文本', 0), '[1] 文本');
  assert.equal(normalizeKbCitations('没有引用的正文', 3), '没有引用的正文');
});

test('连续角标与行内多次出现都替换', () => {
  assert.equal(
    normalizeKbCitations('结论[1][2]，见[1]', 2),
    '结论[1](#kb-1)[2](#kb-2)，见[1](#kb-1)',
  );
});

test('parseKbCiteHref 解析合法/非法', () => {
  assert.equal(parseKbCiteHref('#kb-3'), 3);
  assert.equal(parseKbCiteHref('#kb-12'), 12);
  assert.equal(parseKbCiteHref('#kb-0'), null);
  assert.equal(parseKbCiteHref('#kb-x'), null);
  assert.equal(parseKbCiteHref('https://a.com'), null);
  assert.equal(parseKbCiteHref(undefined), null);
  assert.equal(parseKbCiteHref('#'), null);
});
