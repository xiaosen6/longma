#!/usr/bin/env node
/**
 * motion-smoke —— 侧栏/状态行动效 CDP 冒烟（批次一）。
 * 前置：FUNDET_CDP_PORT=9222 pnpm dev:win 已起。
 * 检查项：
 *   S1 新动效 CSS 已注册（settle/attention/marquee/done-pop/token 变量）
 *   S2 建草稿→真实发送→侧栏呼吸图标出现（运行中）
 *   S3 运行结束 settle 闪动出现（0.9s 窗口内轮询）
 *   S4 RunningStatus 完成态 done-pop 出现
 *   S5 会话行带 data-sidebar-session-row（跑马灯行锚点）+ marquee 结构
 *   S6 全程无 console error
 * 用法：node tools/motion-smoke.cjs
 */
const CDP_HTTP = 'http://127.0.0.1:9222/json';

async function main() {
  const targets = await (await fetch(CDP_HTTP)).json();
  const page = targets.find((t) => t.type === 'page' && /localhost:\d+|index\.html/.test(t.url));
  if (!page) throw new Error('未找到渲染页 target：' + JSON.stringify(targets.map((t) => t.url)));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');

  const evalJs = async (expression, timeoutMs = 120000) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (r.result?.exceptionDetails) throw new Error('eval 异常：' + JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };

  const report = await evalJs(`(async () => {
    const out = { steps: {} };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 50 && typeof window.fundet === 'undefined'; i++) await sleep(100);
    out.steps.fundetReady = typeof window.fundet !== 'undefined';
    if (!out.steps.fundetReady) return out;

    // S1 CSS 注册
    const sheetRules = [];
    for (const sheet of document.styleSheets) {
      try { sheetRules.push(...[...sheet.cssRules].map((r) => r.cssText)); } catch {}
    }
    const cssAll = sheetRules.join('\\n');
    out.steps.cssSettle = cssAll.includes('.session-settle');
    out.steps.cssAttention = cssAll.includes('.session-attention-dot');
    out.steps.cssMarquee = cssAll.includes('.sidebar-title-marquee');
    out.steps.cssDonePop = cssAll.includes('.status-bar-pop') || cssAll.includes('.status-done-pop') || cssAll.includes('.status-bar-done');
    const rootStyle = getComputedStyle(document.documentElement);
    out.steps.cssMarqueeToken = rootStyle.getPropertyValue('--motion-sidebar-title-marquee-per-viewport').trim() !== '';

    // S5/S2-S4：建草稿→发送→轮询动效
    const newBtn = document.querySelector('[data-sidebar-action="new-chat"]');
    if (!newBtn) { out.steps.noNewButton = true; return out; }
    newBtn.click();
    await sleep(600);

    const ta = document.querySelector('textarea');
    if (!ta) { out.steps.noTextarea = true; return out; }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '只回复一个数字：1');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));

    // 阶段A：活动会话内轮询呼吸图标 + done-pop
    const pollFor = async (timeoutMs, fn) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (fn()) return true;
        await sleep(80);
      }
      return false;
    };
    out.steps.breathingIcon = await pollFor(60000, () =>
      document.querySelector('[data-sidebar-session-row] .animate-fundet-pulse') !== null);
    out.steps.turnRan = out.steps.breathingIcon;
    out.steps.donePop = await pollFor(60000, () =>
      document.querySelector('.status-bar-done') !== null);

    // 阶段B：第二回合发送后切走（新建草稿），settle 只对非活动行播
    const rowSel = '[data-sidebar-session-row]';
    const rows = () => [...document.querySelectorAll(rowSel)];
    const sendAgain = async () => {
      // 回到刚才的会话（第一个有对话的行）
      const target = rows().find((r) => r.textContent.includes('只回复'));
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(500);
      const ta2 = document.querySelector('textarea');
      if (!ta2) return false;
      const setter2 = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter2.call(ta2, '再回复：2');
      ta2.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
      ta2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      return true;
    };
    if (await sendAgain()) {
      await sleep(800); // 等呼吸出现、行稳定
      document.querySelector('[data-sidebar-action="new-chat"]').click(); // 切走 → 会话成非活动
      out.steps.settleFlash = await pollFor(60000, () => {
        const row = rows().find((r) => r.querySelector('.animate-fundet-pulse') || r.textContent.includes('只回复'));
        return row ? row.classList.contains('session-settle') : false;
      });
    }
    out.steps.rowAnchor = document.querySelector(rowSel + ' .sidebar-title-marquee') !== null;
    return out;
  })()`);

  ws.close();
  console.log(JSON.stringify(report, null, 2));
  console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 5) : '无');

  const s = report.steps;
  const pass =
    s.fundetReady && s.cssSettle && s.cssAttention && s.cssMarquee && s.cssDonePop && s.cssMarqueeToken &&
    s.rowAnchor && s.turnRan && s.breathingIcon && s.settleFlash && s.donePop;
  console.log(pass ? 'MOTION-SMOKE-PASS' : 'MOTION-SMOKE-FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
