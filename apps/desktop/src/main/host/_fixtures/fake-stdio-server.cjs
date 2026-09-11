// 假 stdio MCP server（测试 fixture）：NDJSON JSON-RPC over stdin/stdout。
// 方法：initialize（握手）/ echo（回显 params）/ stats（收到的 initialize 次数）/
//       hang（永不回复，测挂起兜底）/ die（进程退出，测 failAllPending）。
let buf = '';
let initializeCount = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i);
    buf = buf.slice(i + 1);
    onLine(l);
  }
});
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function onLine(l) {
  if (!l.trim()) return;
  let m;
  try {
    m = JSON.parse(l);
  } catch {
    return;
  }
  if (m.id === undefined || m.id === null) return; // notification 忽略
  if (m.method === 'initialize') {
    initializeCount += 1;
    return send({ jsonrpc: '2.0', id: m.id, result: { serverInfo: { name: 'fake', version: '1' }, capabilities: {} } });
  }
  if (m.method === 'echo') return send({ jsonrpc: '2.0', id: m.id, result: { echoed: m.params ?? null } });
  if (m.method === 'stats') return send({ jsonrpc: '2.0', id: m.id, result: { initializeCount } });
  if (m.method === 'hang') return; // 永不回复
  if (m.method === 'die') process.exit(1);
  send({ jsonrpc: '2.0', id: m.id, result: { ok: true } });
}
