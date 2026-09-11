/**
 * IPC handler 聚合注册：各域 handler 在 ipc/handlers/*，会话事件/审批核心在 ipc/session-core.ts。
 * broadcast/wireSession 的 re-export 保持既有调用方（index.ts、im/dispatcher）import 路径不变。
 */
import { broadcast, wireSession } from './session-core.js';
import { registerSessionHandlers } from './handlers/session.js';
import { registerProviderHandlers } from './handlers/providers.js';
import { registerMcpHandlers } from './handlers/mcp.js';
import { registerKnowledgeHandlers } from './handlers/knowledge.js';
import { registerSystemHandlers } from './handlers/system.js';
import { registerSearchHandlers } from './handlers/search.js';
import { registerBrowserHandlers } from './handlers/browser.js';
import { registerComputerHandlers } from './handlers/computer.js';
import { registerSkillHandlers } from './handlers/skills.js';

export { broadcast, wireSession } from './session-core.js';

export function registerIpcHandlers(): void {
  registerSessionHandlers();
  registerProviderHandlers();
  registerMcpHandlers();
  registerKnowledgeHandlers();
  registerSystemHandlers();
  registerSearchHandlers();
  registerBrowserHandlers();
  registerComputerHandlers();
  registerSkillHandlers();
}
