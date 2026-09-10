/**
 * MCP 后台心跳：对 http 类 server 周期探测（60s），状态翻转时推给渲染层
 * （设置页状态点实时变灰/变绿）。
 *
 * 刻意不轮询 stdio：探测 = 真实 spawn 子进程 + initialize 握手，反复拉起
 * （如 blender-mcp 连着 Blender 实例）有副作用。stdio 状态由按需探测触发。
 */
import type { Logger } from '@fundet/agent-core';
import { listMcpServers } from './db/mcp-servers.js';
import { testMcpConnection } from './host/mcp-bridge.js';
import { FUNDET_PUSH } from './ipc/channels.js';

const INTERVAL_MS = 60_000;

type Broadcast = (channel: string, payload: unknown) => void;

const lastState = new Map<string, boolean>();
let timer: NodeJS.Timeout | null = null;
let running = false;

async function probeOnce(broadcast: Broadcast, logger: Logger): Promise<void> {
  if (running) return;
  running = true;
  try {
    const httpServers = listMcpServers().filter((s) => s.type === 'http' && s.enabled);
    // 清掉已删除 server 的缓存
    const alive = new Set(httpServers.map((s) => s.id));
    for (const id of [...lastState.keys()]) {
      if (!alive.has(id)) lastState.delete(id);
    }
    for (const config of httpServers) {
      try {
        const result = await testMcpConnection(config);
        const prev = lastState.get(config.id);
        lastState.set(config.id, result.ok);
        // 首轮不推（面板打开时会主动探测），只在状态翻转时推
        if (prev !== undefined && prev !== result.ok) {
          broadcast(FUNDET_PUSH.MCP_STATUS, {
            id: config.id,
            ok: result.ok,
            ...(result.error ? { error: result.error } : {}),
            latencyMs: result.latencyMs,
          });
          logger.info('mcp 状态翻转', { name: config.name, ok: result.ok });
        }
      } catch (err) {
        logger.warn('mcp 心跳探测异常', { name: config.name, error: String(err) });
      }
    }
  } finally {
    running = false;
  }
}

/** app ready 后启动；dev 与打包版都跑（本地优先，探测只出本机/用户配置的端点） */
export function startMcpHeartbeat(broadcast: Broadcast, logger: Logger): void {
  if (timer) return;
  void probeOnce(broadcast, logger);
  timer = setInterval(() => void probeOnce(broadcast, logger), INTERVAL_MS);
  timer.unref?.();
}

export function stopMcpHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
