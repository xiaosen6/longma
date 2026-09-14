/** 破图修复验证：验证会话（DB 注入）里裸文件名应退化为 code、相对路径应真预览 */
const CDP_PORT = process.env.CDP_PORT ?? '9222';
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !t.url.includes('/pet.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pendingCalls = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pendingCalls.has(msg.id)) { pendingCalls.get(msg.id)(msg); pendingCalls.delete(msg.id); }
};
function evalJs(expression) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  return new Promise((resolve) => pendingCalls.set(id, resolve));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 20; i++) {
  const r = await evalJs("typeof window.fundet === 'object'");
  if (r.result?.result?.value === true) break;
  await sleep(500);
}

// 侧栏点击验证会话
const clicked = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('aside div, aside button, aside a')];
  const row = rows.find((x) => (x.textContent || '').includes('渲染验证'));
  if (!row) return false;
  let el = row;
  while (el && el.tagName !== 'A' && !el.onclick && el.parentElement) el = el.parentElement;
  (el && el !== row ? el : row).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
})()`);
console.log('点中验证会话:', clicked.result?.result?.value);
await sleep(3000);

const check = await evalJs(`(() => {
  const codes = [...document.querySelectorAll('.md code')].map(c => c.textContent);
  const imgs = [...document.querySelectorAll('.md img')].map(i => ({ src: i.src.slice(0, 70), ok: i.complete && i.naturalWidth > 0 }));
  return { codes, imgs };
})()`);
console.log(JSON.stringify(check.result?.result?.value, null, 1));
ws.close();
