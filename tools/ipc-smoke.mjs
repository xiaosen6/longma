/**
 * IPC 拆分冒烟：对运行中的 dev 实例（FUNDET_CDP_PORT=9222）逐域调用 window.fundet API，
 * 验证 register.ts 聚合拆分后全部 handler 注册且响应。
 * 用法：FUNDET_CDP_PORT=9222 pnpm dev 先起，再 node tools/ipc-smoke.mjs
 */
const CDP_PORT = process.env.CDP_PORT ?? '9222';
const BASE = `http://127.0.0.1:${CDP_PORT}`;

async function getPageWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await (await fetch(`${BASE}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
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
  if (msg.id && pendingCalls.has(msg.id)) {
    pendingCalls.get(msg.id)(msg);
    pendingCalls.delete(msg.id);
  }
};
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pendingCalls.set(id, resolve));
}

async function evalJs(expression) {
  const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
}

// 等 preload 注入
for (let i = 0; i < 30; i++) {
  if (await evalJs('typeof window.fundet') === 'object') break;
  await new Promise((r) => setTimeout(r, 500));
}

const checks = [
  ['session', 'fundet.listSessions()'],
  ['providers', 'fundet.listProviders()'],
  ['mcp', 'fundet.listMcpServers()'],
  ['knowledge', 'fundet.listKnowledgeBases()'],
  ['search', 'fundet.searchStatus()'],
  ['browser', 'fundet.browserStatus()'],
  ['computer', 'fundet.computerStatus()'],
  ['skills', 'fundet.listSkills()'],
  ['usage(session)', 'fundet.usageHistory(7)'],
  ['system(fs)', 'fundet.userHome()'],
];

let fail = 0;
for (const [domain, expr] of checks) {
  try {
    const v = await evalJs(expr);
    const summary = Array.isArray(v) ? `array[${v.length}]` : typeof v === 'object' && v ? Object.keys(v).slice(0, 4).join(',') : String(v);
    console.log(`OK   ${domain.padEnd(14)} -> ${summary}`);
  } catch (err) {
    fail++;
    console.log(`FAIL ${domain.padEnd(14)} -> ${String(err).slice(0, 160)}`);
  }
}
console.log(fail === 0 ? 'IPC-SMOKE-PASS' : `IPC-SMOKE-FAIL(${fail})`);
process.exit(fail === 0 ? 0 : 1);
