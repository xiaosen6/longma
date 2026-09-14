/** Cindy 移植批次验证：页面就绪等待 + 侧栏排序按钮 + 复用 kb-cite-e2e 前置步骤。 */
const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${CDP_PORT}`;

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`${BASE}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && !t.url.includes('/pet.html'));
      if (page) return page;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('CDP/page 未就绪');
}

const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
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

// 等页面挂载完（window.fundet + 正文出现）
for (let i = 0; i < 30; i++) {
  const ready = await evalJs("typeof window.fundet === 'object' && (document.body.innerText || '').length > 10");
  if (ready.result?.result?.value === true) break;
  await sleep(1000);
}

let fail = 0;
async function check(name, expr) {
  const r = await evalJs(expr);
  const ok = r.result?.result?.value === true;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
}

await check('侧栏排序按钮存在', "[...document.querySelectorAll('button')].some(b => (b.getAttribute('data-sidebar-action') || '') === 'sort-toggle')");
await check('排序按钮可点击切换', "(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('data-sidebar-action') || '') === 'sort-toggle'); if (!b) return false; b.click(); return localStorage.getItem('longma.sidebar-sort') === 'created'; })()");
await evalJs("try { localStorage.setItem('longma.sidebar-sort', 'active'); } catch (e) {}");

console.log(fail === 0 ? 'CINDY-BATCH-PASS' : `CINDY-BATCH-FAIL(${fail})`);
process.exit(fail === 0 ? 0 : 1);
