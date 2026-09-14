/** 诊断：验证会话是否在侧栏/DB 层可见 */
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
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
const v = await evalJs(`(async () => {
  const list = await window.fundet.listSessions();
  const aside = document.querySelector('aside');
  return {
    sessionCount: list.length,
    hasVerify: list.some((s) => s.id === 'verify-broken-img-fix'),
    titles: list.slice(0, 5).map((s) => s.title),
    asideHead: aside ? aside.innerText.slice(0, 200) : '(no aside)',
  };
})()`);
console.log(JSON.stringify(v.result?.result?.value, null, 1));
ws.close();
