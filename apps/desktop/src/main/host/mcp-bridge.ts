/**
 * Fundet MCP 桥：把用户配置的外部 MCP server 注入 pi 会话。
 *
 * 机制（pi 无内置 MCP，只能走 cindy-bridge 扩展）：
 *  - PiAgent.startSession 调 deps.preparePiExtraSpawnConfig（本文件实现），拿到
 *    { mcpBridge: {token, servers}, mcpEnv, disposeSessionCtx }；
 *  - servers 描述符经 CINDY_PI_MCP_BRIDGE env 传给 pi 内的 cindy-bridge 扩展，
 *    它用 streamable-HTTP 连每个 server（initialize → tools/list → 注册成
 *    mcp__<server>__<tool> 工具，execute 转发 tools/call）。
 *
 * 两类 server：
 *  - http：描述符直通（remote.headerEnvVars 指 header 名 → env 变量名，真值经
 *    mcpEnv 只进 pi 父进程 env，不落描述符）。host 零转发。
 *  - stdio：bridge 只会说 streamable-HTTP，host 必须自己当中间人 —— spawn 子进程
 *    （MCP stdio = NDJSON），再用 localhost http 代理按 Bearer token 鉴权转发。
 *    代理在 prepare 阶段先完成 initialize 握手并缓存结果（npx 冷启动可能远超
 *    bridge 扩展 10s 启动预算），bridge 的 initialize 直接回缓存。
 *
 * 生命周期：每次 startSession 重建（stdio 子进程随会话拉起），disposeSessionCtx
 * 在会话 close 时由 PiAgent 调用（幂等），关闭 http 代理 + 杀子进程。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type {
  Logger,
  McpProvider,
  PiExtraSpawnConfig,
  PiExtraSpawnConfigContext,
  PiMcpServerRef,
} from '@fundet/agent-core';
import { createConsoleLogger } from '@fundet/agent-core';
import { SEARCH_MCP_SERVER_NAME } from '../../shared/search-engines.ts';
import { KNOWLEDGE_MCP_SERVER_NAME } from '../../shared/knowledge.ts';
import { BROWSER_ENABLED_SETTING, BROWSER_MCP_SERVER_NAME } from '../../shared/browser-settings.ts';
import { COMPUTER_ENABLED_SETTING, COMPUTER_MCP_SERVER_NAME } from '../../shared/computer-settings.ts';
import { resolveCuaDriverCommand } from '../computer/driver.ts';
import { listMcpServers, resolveServerHeaders, type McpServerView } from '../db/mcp-servers.js';
import { getBoolSetting } from '../db/settings.js';
import { startSearchMcpServer } from '../search/mcp-server.ts';
import { handleWebSearch } from '../search/tool.ts';
import { startKnowledgeMcpServer } from '../knowledge/mcp-server.ts';
import { handleKnowledgeTool } from '../knowledge/tool.ts';
import { ensureBrowserRuntime } from '../browser/host.js';
import { startBrowserMcpServer } from '../browser/mcp-http.js';


// StdioMcpHttpProxy 与常量拆至 stdio-mcp-proxy.ts（独立可单测，无 electron/db 链依赖）
import { StdioMcpHttpProxy } from './stdio-mcp-proxy.ts';
export { StdioMcpHttpProxy } from './stdio-mcp-proxy.ts';

/** http server 的 header 名 → pi 父进程 env 变量名（真值经 mcpEnv 注入，不落描述符） */
function headerEnvVarName(serverName: string, headerName: string): string {
  const sanitize = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `FUNDET_MCP_HDR_${sanitize(serverName)}_${sanitize(headerName)}`;
}

/**
 * AgentDeps.preparePiExtraSpawnConfig 的 Fundet 实现。
 * 始终注入内置搜索 MCP（设置里的 Tavily/Brave/博查/智谱）；再叠加用户表里的外部 server。
 */
export function createPreparePiExtraSpawnConfig(logger: Logger) {
  return async (
    _providers: McpProvider[],
    _ctx?: PiExtraSpawnConfigContext,
  ): Promise<PiExtraSpawnConfig | null> => {
    const configs = listMcpServers().filter((s) => s.enabled);
    const token = randomBytes(32).toString('base64url');
    const servers: PiMcpServerRef[] = [];
    const mcpEnv: Record<string, string> = {};
    // 单个 server 失败不拖垮整次会话（其余 server 照常注入）——与 pi 侧
    // "MCP bridge prep failed, continuing without cindy tools" 的容错口径一致。
    const disposers: Array<() => void> = [];

    try {
      const search = await startSearchMcpServer(token, logger.child('search-mcp'), handleWebSearch);
      disposers.push(search.dispose);
      servers.push({ name: SEARCH_MCP_SERVER_NAME, url: search.url });
    } catch (err) {
      logger.error('内置搜索 MCP 启动失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 知识库（设置 → 知识库）：无条件装配，未建库时工具返回指引文案。
    // 只读本机检索，审批对齐 search（auto-approve 在 register 侧配置）。
    try {
      const knowledge = await startKnowledgeMcpServer(token, logger.child('knowledge-mcp'), handleKnowledgeTool);
      disposers.push(knowledge.dispose);
      servers.push({ name: KNOWLEDGE_MCP_SERVER_NAME, url: knowledge.url });
    } catch (err) {
      logger.error('内置知识库 MCP 启动失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 浏览器自动化（设置 → 通用，默认关）：runtime 是进程级单例，这里只挂
    // 每会话一份 MCP server。审批不进白名单——跟会话权限三档走（ask 每次问）。
    try {
      if (getBoolSetting(BROWSER_ENABLED_SETTING, false)) {
        const runtime = await ensureBrowserRuntime(logger);
        if (runtime) {
          const browser = await startBrowserMcpServer(token, logger.child('browser-mcp'), runtime);
          disposers.push(browser.dispose);
          servers.push({
            name: BROWSER_MCP_SERVER_NAME,
            url: browser.url,
            remote: {
              headerEnvVars: {},
              // navigate/act 可能跑几十秒，给满 bridge 硬边界
              startupTimeoutMs: 30_000,
              requestTimeoutMs: 600_000,
            },
          });
        }
      }
    } catch (err) {
      logger.error('浏览器 MCP 启动失败（跳过，其余 server 照常）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 电脑操作（设置 → 通用，默认关）：cua-driver 是外部 Rust 二进制（stdio
    // MCP server，子命令 mcp），直接经 StdioMcpHttpProxy 挂载——截屏/输入
    // 能力全在 driver 内。审批不进白名单，跟会话权限三档走。
    try {
      if (getBoolSetting(COMPUTER_ENABLED_SETTING, false)) {
        const command = resolveCuaDriverCommand();
        if (!command) {
          logger.warn('电脑操作已开启但 cua-driver 二进制缺失（tools/cua-driver/update.mjs 下载 / 重装应用）');
        } else {
          const proxy = new StdioMcpHttpProxy(
            {
              id: 'builtin-computer',
              name: COMPUTER_MCP_SERVER_NAME,
              type: 'stdio',
              enabled: true,
              command,
              args: ['mcp'],
              url: null,
              headers: {},
              hasToken: false,
              createdAt: 0,
            },
            token,
            logger.child(`mcp:${COMPUTER_MCP_SERVER_NAME}`),
          );
          const url = await proxy.start();
          disposers.push(() => proxy.dispose());
          servers.push({ name: COMPUTER_MCP_SERVER_NAME, url });
        }
      }
    } catch (err) {
      logger.error('电脑操作 MCP 启动失败（跳过，其余 server 照常）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const config of configs) {
      try {
        if (config.type === 'http') {
          // Bearer token 走 safeStorage（mcp-token-<id>），不落库；合成逻辑统一在 resolveServerHeaders
          const headers = resolveServerHeaders(config);
          const headerEnvVars: Record<string, string> = {};
          for (const [headerName, value] of Object.entries(headers)) {
            const envName = headerEnvVarName(config.name, headerName);
            headerEnvVars[headerName] = envName;
            mcpEnv[envName] = value;
          }
          servers.push({
            name: config.name,
            url: config.url!,
            remote: {
              headerEnvVars,
              // 须在 bridge 的硬边界内（startup < 30s / request <= 600s，超出会被 clamp）
              startupTimeoutMs: 10_000,
              requestTimeoutMs: 600_000,
            },
          });
        } else {
          const proxy = new StdioMcpHttpProxy(config, token, logger.child(`mcp:${config.name}`));
          const url = await proxy.start();
          disposers.push(() => proxy.dispose());
          servers.push({ name: config.name, url });
        }
      } catch (err) {
        logger.error('MCP server 装配失败（跳过该 server）', {
          name: config.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (servers.length === 0) {
      for (const dispose of disposers) dispose();
      return null;
    }

    let disposed = false;
    return {
      mcpBridge: { token, servers },
      mcpEnv,
      disposeSessionCtx: () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      },
    };
  };
}

export interface McpConnectionTestResult {
  ok: boolean;
  error?: string;
  latencyMs: number;
}

/**
 * MCP server 连通性探测（设置页状态点）：
 *  - http：POST initialize（10s 超时），2xx 即视为可达（完整握手由会话装配兜底）；
 *  - stdio：spawn + initialize 握手（npx 冷启动预算同装配 10s），完成后立即回收。
 */
export async function testMcpConnection(config: McpServerView): Promise<McpConnectionTestResult> {
  const started = Date.now();
  const done = (ok: boolean, error?: string): McpConnectionTestResult => ({
    ok,
    ...(error ? { error } : {}),
    latencyMs: Date.now() - started,
  });
  if (config.type === 'http') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(config.url!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...resolveServerHeaders(config),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'fundet-mcp-proxy', version: '1.0.0' },
          },
        }),
        signal: controller.signal,
      });
      return res.ok ? done(true) : done(false, `HTTP ${res.status}`);
    } catch (err) {
      const e = err as Error & { name?: string };
      return done(false, e.name === 'AbortError' || e.name === 'TimeoutError' ? '连接超时' : e.message || String(err));
    } finally {
      clearTimeout(timer);
    }
  }
  // stdio：完整走一次 spawn + 握手，结束即回收
  const logger = createConsoleLogger('fundet:mcp-test');
  const proxy = new StdioMcpHttpProxy(config, 'probe-token', logger.child('mcp-test'));
  try {
    await proxy.start();
    return done(true);
  } catch (err) {
    return done(false, err instanceof Error ? err.message : String(err));
  } finally {
    proxy.dispose();
  }
}
