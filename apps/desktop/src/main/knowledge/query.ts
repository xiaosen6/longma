/**
 * 知识库检索查询预处理（纯函数，无 electron 依赖，可 node --test 单测）。
 *
 * 三层：
 *  1. 标点/空白拆词元；
 *  2. 中文无分隔符、长 token 是整句——短语匹配必空：≥6 字 token 滑窗切
 *     连续 4 字子短语（步进 2）OR 连接，任一命中即召回（bm25 排序压噪）；
 *  3. <3 字符词元留给 LIKE 兜底路（trigram 只认 ≥3）。
 */
const SLIDE_WINDOW = 4;
const SLIDE_STEP = 2;
const LONG_TOKEN = 6;

const CJK_RE = /[一-鿿]/u;

function expandToken(token: string): string[] {
  // 英文/数字词元有天然分隔，原样短语；仅长 CJK 连续段（无分隔符的整句）滑窗
  if (token.length < LONG_TOKEN || !CJK_RE.test(token)) return [token];
  const parts: string[] = [];
  for (let i = 0; i + SLIDE_WINDOW <= token.length; i += SLIDE_STEP) {
    parts.push(token.slice(i, i + SLIDE_WINDOW));
  }
  // 末尾不足窗口的余量（长度 ≥3 才对 trigram 有意义）
  const tail = token.slice(-(SLIDE_WINDOW - 1));
  if (tail.length >= 3 && !parts.includes(tail)) parts.push(tail);
  return parts;
}

export function buildKnowledgeQuery(query: string): { ftsExpr: string; shortTerms: string[] } {
  const tokens = query
    .split(/[\s,，。；;？！?!:：、()（）[\]【】"'‘’“”`~@#%^&*+=|\\/<>]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const shortTerms = tokens.filter((t) => t.length < 3);
  const ftsTokens = tokens
    .filter((t) => t.length >= 3)
    .flatMap((t) => expandToken(t));
  const ftsExpr = ftsTokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
  return { ftsExpr, shortTerms };
}
