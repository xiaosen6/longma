/** 用户 MCP 服务器域 IPC：CRUD + 连通性探测。 */
import { ipcMain } from 'electron';
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  updateMcpServer,
  type McpServerInput,
} from '../../db/mcp-servers.js';
import { testMcpConnection } from '../../host/mcp-bridge.js';
import { FUNDET_INVOKE } from '../channels.js';

export function registerMcpHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.MCP_LIST, async () => listMcpServers());

  ipcMain.handle(FUNDET_INVOKE.MCP_CREATE, async (_e, input: McpServerInput) =>
    createMcpServer(input),
  );

  ipcMain.handle(FUNDET_INVOKE.MCP_UPDATE, async (_e, id: string, patch: Partial<McpServerInput>) =>
    updateMcpServer(id, patch),
  );

  ipcMain.handle(FUNDET_INVOKE.MCP_DELETE, async (_e, id: string) => {
    deleteMcpServer(id);
  });

  ipcMain.handle(FUNDET_INVOKE.MCP_TEST_CONNECTION, async (_e, id: string) => {
    const config = listMcpServers().find((s) => s.id === id);
    if (!config) throw new Error(`MCP server not found: ${id}`);
    return testMcpConnection(config);
  });
}
