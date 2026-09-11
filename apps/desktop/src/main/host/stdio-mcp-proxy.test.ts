/**
 * StdioMcpHttpProxy 单测：假 stdio MCP server（_fixtures/fake-stdio-server.cjs）
 * 覆盖：预热握手 / http 转发回显 / Bearer 鉴权 / initialize 缓存（server 只见一次）/
 * notification 202 / 子进程退出拒 pending / dispose 幂等。
 * 真实 600s 超时不在此测（常量导出供断言）；挂起场景用子进程退出兜底路径覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioMcpHttpProxy, PROXY_REQUEST_TIMEOUT_MS } from './stdio-mcp-proxy.ts';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '_fixtures', 'fake-stdio-server.cjs');

const config = {
  id: 'test-stdio',
  name: 'test-stdio',
  type: 'stdio',
  enabled: true,
  command: process.execPath,
  args: [FIXTURE],
  url: null,
  headers: {},
  hasToken: false,
  createdAt: 0,
} as const;

const logger = {
  info(): void {},
  warn(): void {},
  error(): void {},
  debug(): void {},
  child() {
    return this;
  },
};

async function post(url: string, token: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

test('start() 预热握手成功并返回 http URL', async () => {
  const proxy = new StdioMcpHttpProxy(config, 'tok', logger as any);
  const url = await proxy.start();
  assert.ok(url.startsWith('http://127.0.0.1:'), `url 形如 ${url}`);
  assert.equal(proxy.started, true);
  proxy.dispose();
});

test('转发带 id 请求并回显结果；错误 token 401', async () => {
  const proxy = new StdioMcpHttpProxy(config, 'tok', logger as any);
  const url = await proxy.start();
  const ok = await post(url, 'tok', { jsonrpc: '2.0', id: 1, method: 'echo', params: { a: 1 } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.result.echoed, { a: 1 });
  const bad = await post(url, 'wrong', { jsonrpc: '2.0', id: 2, method: 'echo' });
  assert.equal(bad.status, 401);
  proxy.dispose();
});

test('initialize 回预热缓存：server 只收到一次 initialize', async () => {
  const proxy = new StdioMcpHttpProxy(config, 'tok', logger as any);
  const url = await proxy.start();
  // bridge 视角再 initialize 一次（拿缓存）
  const again = await post(url, 'tok', { jsonrpc: '2.0', id: 7, method: 'initialize', params: {} });
  assert.equal(again.status, 200);
  assert.equal(again.json.result.serverInfo.name, 'fake');
  // server 实际只见过 host 预热那一次
  const stats = await post(url, 'tok', { jsonrpc: '2.0', id: 8, method: 'stats' });
  assert.equal(stats.json.result.initializeCount, 1);
  proxy.dispose();
});

test('notification（无 id）返回 202', async () => {
  const proxy = new StdioMcpHttpProxy(config, 'tok', logger as any);
  const url = await proxy.start();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(res.status, 202);
  proxy.dispose();
});

test('子进程退出后在途请求被拒（500），proxy 不再可用', async () => {
  const proxy = new StdioMcpHttpProxy(config, 'tok', logger as any);
  const url = await proxy.start();
  // hang 请求挂起 → kill server → failAllPending 让 hang 结算为 500
  const hangP = post(url, 'tok', { jsonrpc: '2.0', id: 10, method: 'hang' });
  await post(url, 'tok', { jsonrpc: '2.0', id: 11, method: 'die' });
  const hang = await hangP;
  assert.equal(hang.status, 500);
  proxy.dispose();
});

test('dispose() 幂等且后续连接被拒', async () => {
  const proxy = new StdioMcpHttpProxy(config, 'tok', logger as any);
  const url = await proxy.start();
  proxy.dispose();
  proxy.dispose(); // 幂等
  await assert.rejects(() => fetch(url, { method: 'POST' }), /fetch failed|ECONNREFUSED/);
});

test('超时常量导出（600s 防挂起，不实际等待）', () => {
  assert.equal(PROXY_REQUEST_TIMEOUT_MS, 600_000);
});
