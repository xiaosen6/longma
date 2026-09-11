/**
 * 审批队列（从 session-core 拆出，broadcast 注入——无 electron 依赖，可单测）。
 *
 * 语义：
 *  - permission 请求 10 分钟兜底超时：自动 deny + 广播 dismissed(timeout)，防 pi 侧永久挂起；
 *  - settle 成功时广播 dismissed(resolved)；二次 settle / 未知 requestId 返回 false；
 *  - 非 permission 请求（ask/plan 引导类）不设超时，等用户或会话关闭处理。
 */
import type { InteractionDecision, InteractionRequest } from '@fundet/agent-core';
import { FUNDET_PUSH } from './channels.ts';

export const PERMISSION_INTERACTION_TIMEOUT_MS = 10 * 60 * 1000;

export interface PendingInteraction {
  sessionId: string;
  request: InteractionRequest;
  resolve: (decision: InteractionDecision) => void;
  timer: NodeJS.Timeout | null;
}

export class InteractionQueue {
  private readonly pending = new Map<string, PendingInteraction>();
  private readonly broadcast: (channel: string, payload: unknown) => void;

  // 注：不用构造器参数属性——node --experimental-strip-types（strip-only）不支持该语法
  constructor(broadcast: (channel: string, payload: unknown) => void) {
    this.broadcast = broadcast;
  }

  /** wireSession 的 setInteractionListener 回调：登记待决并广播给渲染层 */
  enqueue(sessionId: string, request: InteractionRequest): Promise<InteractionDecision> {
    return new Promise<InteractionDecision>((resolve) => {
      const entry: PendingInteraction = { sessionId, request, resolve, timer: null };
      if (request.kind === 'permission') {
        entry.timer = setTimeout(() => {
          this.pending.delete(request.requestId);
          this.broadcast(FUNDET_PUSH.INTERACTION_DISMISSED, {
            sessionId,
            requestId: request.requestId,
            reason: 'timeout',
          });
          resolve({ kind: 'permission', behavior: 'deny', reason: '审批超时自动拒绝' });
        }, PERMISSION_INTERACTION_TIMEOUT_MS);
      }
      this.pending.set(request.requestId, entry);
      this.broadcast(FUNDET_PUSH.INTERACTION_REQUEST, { sessionId, request });
    });
  }

  /** 渲染层 resolve 回来的决策结算；不存在/已解决返回 false */
  settle(requestId: string, decision: InteractionDecision): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(decision);
    this.broadcast(FUNDET_PUSH.INTERACTION_DISMISSED, {
      sessionId: entry.sessionId,
      requestId,
      reason: 'resolved',
    });
    return true;
  }

  /** INTERACTION_GET_PENDING：列全部待决（跨会话） */
  list(): Array<{ sessionId: string; request: InteractionRequest }> {
    return Array.from(this.pending.values()).map((p) => ({
      sessionId: p.sessionId,
      request: p.request,
    }));
  }
}
