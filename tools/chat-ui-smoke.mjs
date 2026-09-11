/**
 * ChatPage 拆分冒烟：dev + CDP 下验证渲染层（空态→建会话→头部/输入区/知识库chip）。
 * 前提：FUNDET_CDP_PORT=9222 的 pnpm dev 已启动。
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
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 300));
  return res.result?.result?.value;
}

// 收集 console error
const consoleErrors = [];
await cdp('Runtime.enable');
// 简化：直接在 evaluate 里跑检查序列

const checks = [];
const t = (name, fn) => checks.push({ name, fn });

t('空态渲染(品牌+引导)', async () => {
  const v = await evalJs(`(() => {
    const txt = document.body.innerText || '';
    return { hasBrand: txt.includes('LongMa'), hasGuide: txt.includes('选择文件夹') || txt.includes('连接模型提供商'), hasUsage: !!document.querySelector('.text-12') };
  })()`);
  return v.hasBrand && v.hasGuide;
});

t('新建会话(草稿)', async () => {
  await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => x.textContent.includes('开启新对话'));
    if (!b) throw new Error('未找到「开启新对话」按钮');
    b.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  const v = await evalJs(`(() => ({
    hasHeader: !!document.querySelector('header'),
    hasTextarea: !!document.querySelector('main textarea'),
    hasKnowledgeChip: !!document.querySelector('[title*="知识"], button[title="知识库"]') || document.body.innerText.includes('知识库'),
    hasModelChip: document.body.innerText.includes('模型'),
  }))()`);
  return v.hasHeader && v.hasTextarea;
});

t('头部标题/重命名铅笔', async () => {
  const v = await evalJs(`(() => ({
    title: document.querySelector('header button')?.textContent?.trim() ?? '',
    hasPencil: !!document.querySelector('header button[title="重命名"]'),
  }))()`);
  return v.title.length > 0 && v.hasPencil;
});

t('输入框可输入', async () => {
  const v = await evalJs(`(() => {
    const ta = document.querySelector('main textarea');
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '冒烟测试');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('main textarea').value === '冒烟测试';
  })()`);
  return v === true;
});

t('无 React 崩溃卡', async () => {
  const v = await evalJs(`document.body.innerText.includes('发生错误') || document.body.innerText.includes('Something went wrong')`);
  return v === false;
});

let fail = 0;
for (const { name, fn } of checks) {
  try {
    const ok = await fn();
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok) fail++;
  } catch (err) {
    fail++;
    console.log(`FAIL ${name} -> ${String(err).slice(0, 200)}`);
  }
}
console.log(fail === 0 ? 'UI-SMOKE-PASS' : `UI-SMOKE-FAIL(${fail})`);
process.exit(fail === 0 ? 0 : 1);
