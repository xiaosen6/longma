/** 用户 MCP 服务器域 IPC：CRUD + 连通性探测。 */
import { ipcMain } from 'electron';
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  updateMcpServer,
  type McpServerInput,
} from '../../db/mcp-servers.js';
import { invalidateStdioMcpPool, testMcpConnection } from '../../host/mcp-bridge.js';
import { FUNDET_INVOKE } from '../channels.js';

export function registerMcpHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.MCP_LIST, async () => listMcpServers());

  ipcMain.handle(FUNDET_INVOKE.MCP_CREATE, async (_e, input: McpServerInput) => {
    const view = await createMcpServer(input);
    invalidateStdioMcpPool(); // stdio 池按键失效（配置变了，旧子进程作废）
    return view;
  });

  ipcMain.handle(FUNDET_INVOKE.MCP_UPDATE, async (_e, id: string, patch: Partial<McpServerInput>) => {
    const view = await updateMcpServer(id, patch);
    invalidateStdioMcpPool();
    return view;
  });

  ipcMain.handle(FUNDET_INVOKE.MCP_DELETE, async (_e, id: string) => {
    deleteMcpServer(id);
    invalidateStdioMcpPool();
  });

  ipcMain.handle(FUNDET_INVOKE.MCP_TEST_CONNECTION, async (_e, id: string) => {
    const config = listMcpServers().find((s) => s.id === id);
    if (!config) throw new Error(`MCP server not found: ${id}`);
    return testMcpConnection(config);
  });
}
