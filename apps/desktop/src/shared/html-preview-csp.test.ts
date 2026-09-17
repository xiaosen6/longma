import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HTML_PREVIEW_CSP, withHtmlPreviewCsp } from './html-preview-csp.ts';

describe('withHtmlPreviewCsp（移植 Cindy htmlPreviewCsp）', () => {
  it('前导段含 doctype/CSP meta/guard;闭合标签恰一次且在末尾（中间出现会提前终止）', () => {
    const out = withHtmlPreviewCsp('<html><body>hi</body></html>');
    assert.ok(out.startsWith('<!doctype html>'));
    const metaIdx = out.indexOf('http-equiv="Content-Security-Policy"');
    const scriptIdx = out.indexOf('<script>');
    assert.ok(metaIdx > 0 && scriptIdx > metaIdx); // CSP 在任何作者内容前生效
    assert.ok(out.includes('RTCPeerConnection'));
    const guard = out.slice(0, out.indexOf('<html>'));
    assert.equal(guard.indexOf('</script>'), guard.lastIndexOf('</script>')); // 恰一次
    assert.ok(guard.trimEnd().endsWith('</script>')); // 是 guard 自己的闭合
  });

  it('BOM 前移到最前,不变成游离字符', () => {
    const out = withHtmlPreviewCsp('\uFEFF<html></html>');
    assert.equal(out.charCodeAt(0), 0xfeff);
    assert.ok(out.slice(1).startsWith('<!doctype html>'));
  });

  it('策略关死出网出口,放行 self+data 本地资源', () => {
    assert.ok(HTML_PREVIEW_CSP.includes("connect-src 'none'"));
    assert.ok(HTML_PREVIEW_CSP.includes("default-src 'none'"));
    assert.ok(HTML_PREVIEW_CSP.includes("script-src 'self' 'unsafe-inline' data:"));
    assert.ok(HTML_PREVIEW_CSP.includes("worker-src 'none'"));
  });
});
