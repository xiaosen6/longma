/**
 * 知识库溯源角标 E2E：dev + CDP 下全链验证
 *   选库注入 → 真实发送 → 等回复 → 验正文角标 → 点击展开引用卡 → 收起
 * 前提：FUNDET_CDP_PORT=9222 dev 已起；库里有已索引文档（默认取第一个库）。
 */
const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${CDP_PORT}`;

async function getPageWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await (await fetch(`${BASE}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && !t.url.includes('/pet.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* CDP 还没起来 */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('找不到 renderer page target');
}

const ws = new WebSocket(await getPageWsUrl());
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let msgId = 0;
const pendingCalls = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pendingCalls.has(msg.id)) { pendingCalls.get(msg.id)(msg); pendingCalls.delete(msg.id); }
};
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pendingCalls.set(id, resolve));
}
async function evalJs(expression) {
  const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 400));
  return res.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 0) 等 preload
for (let i = 0; i < 30; i++) { if (await evalJs('typeof window.fundet') === 'object') break; await sleep(500); }

// 1) 选知识库（第一个库）
const bases = await evalJs('fundet.listKnowledgeBases()');
if (!bases || bases.length === 0) throw new Error('没有知识库（先在设置里导入文档）');
const baseId = bases[0].id;
await evalJs(`localStorage.setItem('kb-inject-base-id', ${JSON.stringify(baseId)})`);
console.log(`[1] 选库: ${bases[0].name} (${baseId})`);

// 2) 建草稿会话（轮询等输入框出现）
await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('开启新对话')); if (b) b.click(); return true; })()`);
let taReady = false;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  if (await evalJs(`Boolean(document.querySelector('main textarea'))`) === true) { taReady = true; break; }
}
if (!taReady) throw new Error('会话建立后 10s 内未见输入框');
console.log('[2] 草稿会话已建');

// 3) 输入并发送（真实模型调用）
const q = '推理引擎有什么用？';
const typed = await evalJs(`(() => {
  const ta = document.querySelector('main textarea');
  if (!ta) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  set.call(ta, ${JSON.stringify(q)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
if (typed !== true) throw new Error('textarea 未找到');
await sleep(300);
const sent = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const send = btns.reverse().find(b => (b.getAttribute('aria-label') === '发送' || b.title === '发送'));
  if (send && !send.disabled) { send.click(); return true; }
  return 'send button disabled/missing';
})()`);
if (sent !== true) throw new Error(`发送失败: ${sent}`);
console.log('[3] 消息已发送，等模型回复…');

// 4) 等回复（最长 120s：等运行结束=停止按钮消失+无流式）
let done = false;
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  const st = await evalJs(`(() => {
    const body = document.body.innerText;
    const running = body.includes('Working') || body.includes('停止');
    return { running };
  })()`);
  if (!st.running) { done = true; break; }
}
console.log(`[4] 回复完成: ${done}`);

// 5) 验角标（KbCite 按钮特征：title 以「来源：」开头）
const citeInfo = await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button[title^="来源："]')];
  return { count: btns.length, first: btns[0] ? btns[0].title : null };
})()`);
console.log(`[5] 角标按钮: ${citeInfo.count} 个${citeInfo.first ? `，首个: ${citeInfo.first}` : ''}`);
if (citeInfo.count === 0) throw new Error('正文没有溯源角标（模型未用 [n] 引用或渲染失败）');

// 6) 点击首个角标 → 验引用卡展开 → 收起
await evalJs(`document.querySelector('button[title^="来源："]').click()`);
await sleep(400);
const card = await evalJs(`(() => {
  const t = document.body.innerText;
  const open = t.includes('来源：') && t.includes('块') && document.querySelector('.max-h-\\\\[240px\\\\]');
  return { cardOpen: Boolean(open) };
})()`);
console.log(`[6] 引用卡展开: ${card.cardOpen}`);
await evalJs(`document.querySelector('button[aria-label="收起来源"]').click()`);
await sleep(300);
const closed = await evalJs(`!document.querySelector('button[aria-label="收起来源"]')`);
console.log(`[7] 引用卡收起: ${closed}`);

const pass = citeInfo.count > 0 && card.cardOpen && closed;
console.log(pass ? 'KB-CITE-E2E-PASS' : 'KB-CITE-E2E-FAIL');
process.exit(pass ? 0 : 1);
