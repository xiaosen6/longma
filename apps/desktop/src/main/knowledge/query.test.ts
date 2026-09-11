/** 检索查询预处理单测：自然句拆词 + FTS OR 表达式组装 + 短词分流。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeQuery } from './query.ts';

test('自然句拆词：标点切分，长中文 token 滑窗成 4 字子短语 OR（含尾窗补偿）', () => {
  const { ftsExpr, shortTerms } = buildKnowledgeQuery('推理引擎有什么用？');
  assert.equal(ftsExpr, '"推理引擎" OR "引擎有什" OR "有什么用" OR "什么用"');
  assert.deepEqual(shortTerms, []);
});

test('5 字以下 CJK token 原样短语；两字词走 LIKE 路', () => {
  const { ftsExpr, shortTerms } = buildKnowledgeQuery('推理引擎 作用');
  assert.equal(ftsExpr, '"推理引擎"');
  assert.deepEqual(shortTerms, ['作用']);
});

test('短中文词（<3 字符）走 LIKE 路，不进 FTS', () => {
  const { ftsExpr, shortTerms } = buildKnowledgeQuery('鹿角 是什么');
  assert.equal(ftsExpr, '"是什么"');
  assert.deepEqual(shortTerms, ['鹿角']);
});

test('英文与混合词元', () => {
  const { ftsExpr } = buildKnowledgeQuery('How does Scaling Laws work?');
  assert.equal(ftsExpr, '"How" OR "does" OR "Scaling" OR "Laws" OR "work"');
});

test('引号作为分隔符切分（FTS 表达式里的引号转义为防御性兜底）', () => {
  const { ftsExpr, shortTerms } = buildKnowledgeQuery('带"引号"的词');
  assert.equal(ftsExpr, '');
  assert.deepEqual(shortTerms, ['带', '引号', '的词']);
});

test('纯标点/空查询零词元', () => {
  assert.deepEqual(buildKnowledgeQuery('？？？ '), { ftsExpr: '', shortTerms: [] });
  assert.deepEqual(buildKnowledgeQuery(''), { ftsExpr: '', shortTerms: [] });
});
