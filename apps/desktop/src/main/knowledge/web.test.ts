import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractHtmlTitle, htmlToText } from './web.ts';

test('剥离 script/style 与标签，保留正文', () => {
  const html = `<html><head><title>测试页</title><script>var x = 1;</script></head>
  <body><nav>导航导航</nav><h1>标题一</h1><p>第一段内容。</p><div>第二段内容。</div>
  <style>.a{color:red}</style><footer>页脚信息</footer></body></html>`;
  const text = htmlToText(html);
  assert.ok(text.includes('标题一'));
  assert.ok(text.includes('第一段内容'));
  assert.ok(text.includes('第二段内容'));
  assert.ok(!text.includes('var x'));
  assert.ok(!text.includes('color:red'));
  assert.ok(!text.includes('导航导航'));
  assert.ok(!text.includes('页脚信息'));
});

test('块级标签转换行、br 转行、实体解码', () => {
  const text = htmlToText('<p>行一</p><br>行二 &amp; 行三 &lt;标签&gt; &nbsp; 结尾');
  assert.ok(text.includes('行一\n'));
  assert.ok(text.includes('行二 & 行三 <标签>'));
});

test('数字实体解码', () => {
  assert.ok(htmlToText('&#20013;&#25991;').includes('中文'));
});

test('提取 title', () => {
  assert.equal(extractHtmlTitle('<title>  我的文档 - 站点 </title>'), '我的文档 - 站点');
  assert.equal(extractHtmlTitle('<html><body>x</body></html>'), null);
});
