/**
 * stdio MCP server 的 localhost streamable-HTTP 代理（从 mcp-bridge.ts 拆出，
 * 独立文件便于 node --test 单测——不依赖 electron/db 链）。
 *
 * 协议透明转发（NDJSON 逐行、id 相关），唯二特判：
 *  - initialize 回 host 预热时的缓存结果（避免 bridge 二次 initialize 打到 server）；
 *  - 无 id 的 notification 直接 202。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer, type Server } from 'node:http';
import type { Logger } from '@fundet/agent-core';
import type { McpServerView } from '../db/mcp-servers.js';

/** 单次请求兜底超时（bridge 侧另有 startup/request 预算，这只是防永久挂起） */
export const PROXY_REQUEST_TIMEOUT_MS = 600_000;
/** http body 上限：MCP 工具结果可能带大文本，给到 32MB */
export const PROXY_MAX_BODY_BYTES = 32 * 1024 * 1024;

export class StdioMcpHttpProxy {
  private child: ChildProcess | null = null;
  private server: Server | null = null;
  private readonly pending = new Map<number, {
    resolve: (msg: unknown) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private initializeResult: unknown = null;
  private readonly config: McpServerView;
  private readonly token: string;
  private readonly logger: Logger;
  private readonly spawnOpts?: { cwd?: string; env?: NodeJS.ProcessEnv };

  // 注：不用构造器参数属性——node --experimental-strip-types（strip-only）不支持该语法
  constructor(
    config: McpServerView,
    token: string,
    logger: Logger,
    spawnOpts?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) {
    this.config = config;
    this.token = token;
    this.logger = logger;
    this.spawnOpts = spawnOpts;
  }

  /** 是否曾成功完成 start()（连通性探测用） */
  get started(): boolean {
    return this.initializeResult !== null;
  }

  /** spawn 子进程 + 起 http 监听 + initialize 预热；返回分配给 bridge 的 URL */
  async start(): Promise<string> {
    const command = this.config.command!;
    this.child = spawn(command, this.config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.spawnOpts?.env ?? process.env,
      ...(this.spawnOpts?.cwd ? { cwd: this.spawnOpts.cwd } : {}),
    });
    this.child.on('error', (err) => {
      this.logger.warn('mcp stdio 子进程启动失败', { name: this.config.name, error: String(err) });
      this.failAllPending(new Error(`MCP server "${this.config.name}" spawn failed: ${err.message}`));
    });
    this.child.on('exit', (code, signal) => {
      this.logger.warn('mcp stdio 子进程退出', { name: this.config.name, code, signal });
      this.failAllPending(new Error(`MCP server "${this.config.name}" exited (code=${code})`));
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      // server 自己的日志，截断防刷屏
      this.logger.debug('mcp stdio stderr', {
        name: this.config.name,
        line: chunk.toString('utf8').slice(0, 500).trim(),
      });
    });

    // NDJSON：每行一个 JSON-RPC 消息；有 id 且有人在等 → 结算，否则是 server 主动 notification
    const rl = createInterface({ input: this.child.stdout! });
    rl.on('line', (line) => {
      let msg: { id?: unknown };
      try {
        msg = JSON.parse(line) as { id?: unknown };
      } catch {
        this.logger.warn('mcp stdio 输出非 JSON 行（忽略）', { name: this.config.name, line: line.slice(0, 200) });
        return;
      }
      const id = typeof msg.id === 'number' ? msg.id : null;
      const entry = id !== null ? this.pending.get(id) : undefined;
      if (id === null || !entry) return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    });

    this.server = createServer((req, res) => void this.handleHttp(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('mcp proxy listen failed');
    const url = `http://127.0.0.1:${address.port}/mcp`;

    // 预热：host 侧先跑 initialize 握手，npx 冷启动的等待发生在这里（pi 还没 spawn），
    // bridge 扩展启动时的 initialize 直接回这份缓存，不占它的 10s 启动预算。
    const initMsg = await this.forward({
      jsonrpc: '2.0',
      id: this.allocHostId(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'fundet-mcp-proxy', version: '1.0.0' },
      },
    });
    const initErr = (initMsg as { error?: { message?: string } }).error;
    if (initErr) throw new Error(`MCP server "${this.config.name}" initialize failed: ${initErr.message ?? 'unknown'}`);
    this.initializeResult = (initMsg as { result?: unknown }).result ?? {};
    this.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.logger.info('mcp stdio server 就绪', { name: this.config.name, url });
    return url;
  }

  /** host 侧预热用的 id 段：负数，不与 bridge 转发的正数 id 冲突 */
  private nextHostId = -1;
  private allocHostId(): number {
    return this.nextHostId--;
  }

  /** 转发一条带 id 的请求，按 id 等响应（超时兜底 reject） */
  private forward(message: { id: number } & Record<string, unknown>): Promise<unknown> {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error(`MCP server "${this.config.name}" 不可用`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new Error(`MCP server "${this.config.name}" 请求超时`));
      }, PROXY_REQUEST_TIMEOUT_MS);
      this.pending.set(message.id, { resolve, reject, timer });
      this.child!.stdin!.write(JSON.stringify(message) + '\n');
    });
  }

  /** 无 id 的 notification：只发不等 */
  private notify(message: Record<string, unknown>): void {
    if (this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private failAllPending(err: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }

  private async handleHttp(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const reply = (status: number, body?: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    try {
      if (req.method !== 'POST') return reply(405, { error: 'method not allowed' });
      if (req.headers.authorization !== `Bearer ${this.token}`) return reply(401, { error: 'unauthorized' });

      const body = await new Promise<string>((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf8');
          if (data.length > PROXY_MAX_BODY_BYTES) {
            reject(new Error('body too large'));
            req.destroy();
          }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      const msg = JSON.parse(body) as { id?: unknown; method?: string; params?: unknown };

      // notification（无 id）：转发后 202 空体（bridge 的 notify 接受任意响应）
      if (msg.id === undefined || msg.id === null) {
        this.notify(msg as Record<string, unknown>);
        return reply(202);
      }
      // bridge 的 initialize 回预热缓存（server 只见一次 initialize）
      if (msg.method === 'initialize') {
        return reply(200, { jsonrpc: '2.0', id: msg.id, result: this.initializeResult });
      }
      const result = await this.forward(msg as { id: number } & Record<string, unknown>);
      reply(200, result);
    } catch (err) {
      this.logger.warn('mcp proxy 请求失败', { name: this.config.name, error: String(err) });
      reply(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** 会话关闭：关 http + 杀子进程 + 拒掉在途请求。幂等。 */
  dispose(): void {
    this.failAllPending(new Error(`MCP server "${this.config.name}" 已随会话关闭`));
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}
