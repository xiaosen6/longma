/**
 * 知识库引用角标：把助手正文中的 `[n]`（n ≤ 引用数）替换成可点击的
 * markdown 链接 `[n](#kb-n)`，由 AssistantMessage 的 a 组件拦截渲染成
 * 上标角标并弹层展示原文块。无引用/越界编号原样保留（不误伤普通方括号）。
 */
const CITE_HREF_PREFIX = '#kb-';

/** 正文 [n] → [n](#kb-n)；仅当 1 ≤ n ≤ refCount 时替换 */
export function normalizeKbCitations(text: string, refCount: number): string {
  if (refCount <= 0 || !text.includes('[')) return text;
  return text.replace(/\[(\d{1,2})\]/g, (whole, num: string) => {
    const n = Number(num);
    return n >= 1 && n <= refCount ? `[${n}](${CITE_HREF_PREFIX}${n})` : whole;
  });
}

/** href 是否本知识库角标链接；返回引用编号或 null */
export function parseKbCiteHref(href: string | undefined): number | null {
  if (!href || !href.startsWith(CITE_HREF_PREFIX)) return null;
  const n = Number(href.slice(CITE_HREF_PREFIX.length));
  return Number.isInteger(n) && n >= 1 ? n : null;
}
