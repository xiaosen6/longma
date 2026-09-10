/**
 * 内置知识库 MCP：localhost streamable-HTTP，注入 pi cindy-bridge。
 * 工具名 knowledge_search / knowledge_list → 模型侧 mcp__knowledge__*。
 * 结构照 search/mcp-server.ts；不 import Electron，便于 node --test 直跑协议。
 */
import { createServer, type Server } from 'node:http';

/** 避免测试依赖 @fundet/agent-core 的运行时解析 */
type KnowledgeMcpLogger = {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
};

const BODY_MAX = 1 * 1024 * 1024;

export interface KnowledgeToolOutput {
  text: string;
  isError: boolean;
}

export type KnowledgeToolHandler = (name: string, args: Record<string, unknown>) => Promise<KnowledgeToolOutput>;

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): unknown {
  return { name, description, inputSchema: { type: 'object', properties, required } };
}

const TOOLS = [
  tool(
    'knowledge_search',
    '检索用户本地的知识库（用户导入的文档资料），返回最相关的原文片段（含文件名与位置）。' +
      '用户问题涉及他的文档、资料、公司信息、导入的文件内容时先调用本工具再回答；' +
      'baseId 可省略（默认跨全部知识库检索）。没有知识库时会返回指引。',
    { query: { type: 'string', description: '检索词，用具体的关键词组合，不要整句话照抄' }, baseId: { type: 'string', description: '可选。限定检索的知识库 id' }, limit: { type: 'number', description: '返回条数，默认 6，最大 20' } },
    ['query'],
  ),
  tool(
    'knowledge_list',
    '列出用户本地知识库清单（库名、文件、状态），用于确认有哪些资料可查。',
    {},
    [],
  ),
];

function jsonRpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function dispatch(msg: { id?: unknown; method?: string; params?: unknown }, handler: KnowledgeToolHandler): Promise<unknown> {
  const id = msg.id;
  const method = msg.method ?? '';
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'longma-knowledge', version: '1.0.0' },
      },
    };
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }
  if (method === 'tools/call') {
    const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (params.name !== 'knowledge_search' && params.name !== 'knowledge_list') {
      return jsonRpcError(id, -32601, `unknown tool: ${params.name ?? ''}`);
    }
    const out = await handler(params.name, params.arguments ?? {});
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: out.text }], isError: out.isError },
    };
  }
  if (id === undefined || id === null) return null;
  return jsonRpcError(id, -32601, `unknown method: ${method}`);
}

export function startKnowledgeMcpServer(
  token: string,
  logger: KnowledgeMcpLogger,
  handler: KnowledgeToolHandler,
): Promise<{ url: string; dispose: () => void }> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const reply = (status: number, body?: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json', 'mcp-session-id': 'longma-knowledge' });
        res.end(body === undefined ? undefined : JSON.stringify(body));
      };
      void (async () => {
        try {
          if (req.method === 'DELETE') {
            if (req.headers.authorization !== `Bearer ${token}`) {
              reply(401, { error: 'unauthorized' });
              return;
            }
            res.writeHead(200);
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            reply(405, { error: 'method not allowed' });
            return;
          }
          if (req.headers.authorization !== `Bearer ${token}`) {
            reply(401, { error: 'unauthorized' });
            return;
          }
          const body = await new Promise<string>((ok, fail) => {
            let data = '';
            req.on('data', (chunk: Buffer) => {
              data += chunk.toString('utf8');
              if (data.length > BODY_MAX) {
                fail(new Error('body too large'));
                req.destroy();
              }
            });
            req.on('end', () => ok(data));
            req.on('error', fail);
          });
          const msg = JSON.parse(body) as { id?: unknown; method?: string; params?: unknown };
          if (msg.id === undefined || msg.id === null) {
            reply(202);
            return;
          }
          const out = await dispatch(msg, handler);
          reply(200, out ?? jsonRpcError(msg.id, -32603, 'empty'));
        } catch (err) {
          logger.warn('knowledge mcp 请求失败', { error: String(err) });
          reply(500, { error: err instanceof Error ? err.message : String(err) });
        }
      })();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('knowledge mcp listen failed'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}/mcp`;
      logger.info('内置知识库 MCP 就绪', { url });
      resolve({
        url,
        dispose: () => {
          server.close();
        },
      });
    });
  });
}
