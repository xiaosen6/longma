/**
 * 网页抓取：URL → 纯文本 → Markdown 快照（方案 A，主进程直取，无浏览器依赖）。
 * JS 渲染的 SPA 页面抓到的是空壳——正文过短时抛 WebPageTooThin，提示改用浏览器抓取（二期）。
 * htmlToText 是零依赖的保守剥离：去 script/style/nav/header/footer，块级标签转行，实体解码。
 */

const FETCH_TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
/** 正文低于该字符数视为空壳/失败 */
export const MIN_PAGE_CHARS = 200;

/** 抓取失败（含正文过短），message 面向用户 */
export class WebFetchError extends Error {}

/** HTML → 纯文本（保守剥离，保留块级换行） */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|section|article|h[1-6]|blockquote|pre|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** <title> 文本（无则 null） */
export function extractHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = htmlToText(m[1]);
  return t || null;
}

/**
 * 抓取网页 → Markdown 快照文本（含 OKF 式 frontmatter：url/抓取时间，索引进库前由读取方剥离标题行使用原文本）。
 * 抛 WebFetchError 表示抓取失败或正文过薄。
 */
export async function fetchPageAsMarkdown(url: string): Promise<{ title: string; markdown: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebFetchError('URL 不合法');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebFetchError('仅支持 http/https 网页');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  let finalUrl = url;
  try {
    const res = await fetch(parsed.href, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    finalUrl = res.url || url;
    if (!res.ok) throw new WebFetchError(`网页请求失败（HTTP ${res.status}）`);
    html = await res.text();
  } catch (err) {
    if (err instanceof WebFetchError) throw err;
    const e = err as Error & { name?: string };
    throw new WebFetchError(e.name === 'AbortError' ? '抓取超时（15 秒）' : `抓取失败：${e.message || String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  const title = extractHtmlTitle(html) ?? parsed.hostname;
  const text = htmlToText(html);
  if (text.length < MIN_PAGE_CHARS) {
    throw new WebFetchError(
      '该网页正文内容过少（可能是 JS 渲染的动态页面或需要登录）。暂不支持此类页面，可把页面另存为 md/txt 后以文件导入。',
    );
  }
  const markdown =
    `---\nsource: url\nurl: ${finalUrl}\nfetchedAt: ${new Date().toISOString()}\n---\n\n# ${title}\n\n${text}\n`;
  return { title, markdown };
}
