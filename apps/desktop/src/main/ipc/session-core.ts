/**
 * 会话事件与审批核心（从 register.ts 拆出，模块级状态唯一持有处）。
 *
 * 事件链路：session.onEvent → 选择性落库 messages + 广播 agent:event；
 * 审批链路：session.setInteractionListener → 广播 interaction:request →
 * renderer 调 interaction:resolve → resolver resolve（permission 有 10 分钟兜底 deny）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import type {
  AgentEvent,
  InteractionDecision,
  InteractionRequest,
  Session,
  UserContentBlock,
  UserMessage,
} from '@fundet/agent-core';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { sessions } from '../db/schema.js';
import { insertMessage } from '../db/messages.js';
import { addUsageDelta } from '../db/usage.js';
import { getHost } from '../host/pi-host.js';
import { FUNDET_PUSH } from './channels.js';
import { InteractionQueue } from './interaction-queue.js';
import { documentExtractSupport, extractDocumentText } from '../doc-text.js';
import type { SessionAttachment, SessionSendInput } from '../../shared/fundet-api.js';

/** requestId → 待决审批（跨会话单例；超时/结算语义见 interaction-queue.ts） */
const interactionQueue = new InteractionQueue((channel, payload) => broadcast(channel, payload));
/** 已接线（事件/审批监听）的 sessionId */
const wiredSessions = new Set<string>();

/** 广播给所有窗口（含桌宠窗）；桌宠截图等模块外推送也走这里 */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/** 每会话最近一条 assistant final 正文：RPC replay 重发 message_end 时去重（对齐 Cindy #4180） */
const lastAssistantFinal = new Map<string, string>();

/** 事件落库：user/assistant 文本 + done，工具/thinking/error 事件存 JSON */
function persistEvent(sessionId: string, event: AgentEvent): void {
  try {
    switch (event.type) {
      case 'text': {
        const data = event.data as { text?: string; isFinal?: boolean };
        if (data.isFinal && data.text) {
          if (lastAssistantFinal.get(sessionId) === data.text) break;
          lastAssistantFinal.set(sessionId, data.text);
          insertMessage(sessionId, 'assistant', { text: data.text });
        }
        break;
      }
      case 'thinking': {
        const data = event.data as { stage?: string; text?: string };
        if (data.stage === 'final' && data.text) {
          insertMessage(sessionId, 'thinking', { text: data.text });
        }
        break;
      }
      case 'tool_use':
      case 'tool_result':
        insertMessage(sessionId, 'tool', { kind: event.type, data: event.data });
        break;
      case 'done':
        insertMessage(sessionId, 'done', event.data);
        break;
      case 'error': {
        const data = event.data as { isTerminal?: boolean };
        if (data.isTerminal) insertMessage(sessionId, 'error', event.data);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.warn('[fundet:ipc] 事件落库失败（不阻断事件流）', err);
  }
}

/** 给 Session 装上事件转发 + 审批监听（每会话一次） */
export function wireSession(session: Session): void {
  if (wiredSessions.has(session.id)) return;
  wiredSessions.add(session.id);

  // 用量历史：turn 级增量累计。tokenUsage/costUsd 是会话累计值，做差取增量；
  // 模型归属按会话当前 model（中途换模型轻微误归属，v1 接受）
  const sessionModel =
    getDb().select({ model: sessions.model }).from(sessions).where(eq(sessions.id, session.id)).get()?.model ?? 'unknown';
  let lastTokens = 0;
  let lastCostUsd = 0;
  let lastSplit = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  session.onEvent((event) => {
    persistEvent(session.id, event);
    const data = event.data as {
      tokenUsage?: number; costUsd?: number;
      inputTokens?: number; outputTokens?: number;
      cacheReadTokens?: number; cacheWriteTokens?: number;
    } | undefined;
    if (data && typeof data.tokenUsage === 'number') {
      const dTokens = data.tokenUsage - lastTokens;
      const dCost = typeof data.costUsd === 'number' ? data.costUsd - lastCostUsd : 0;
      // 计数器只会涨；骤降 = 会话重置，丢弃这一跳防负增量
      if (dTokens > 0 || dCost > 0) {
        try {
          addUsageDelta(sessionModel, {
            tokens: Math.max(0, dTokens),
            costUsd: Math.max(0, dCost),
            inputTokens: Math.max(0, (data.inputTokens ?? 0) - lastSplit.input),
            outputTokens: Math.max(0, (data.outputTokens ?? 0) - lastSplit.output),
            cacheReadTokens: Math.max(0, (data.cacheReadTokens ?? 0) - lastSplit.cacheRead),
            cacheWriteTokens: Math.max(0, (data.cacheWriteTokens ?? 0) - lastSplit.cacheWrite),
          });
        } catch {
          /* 用量累计失败不影响会话 */
        }
      }
      lastTokens = data.tokenUsage;
      if (typeof data.costUsd === 'number') lastCostUsd = data.costUsd;
      lastSplit = {
        input: data.inputTokens ?? lastSplit.input,
        output: data.outputTokens ?? lastSplit.output,
        cacheRead: data.cacheReadTokens ?? lastSplit.cacheRead,
        cacheWrite: data.cacheWriteTokens ?? lastSplit.cacheWrite,
      };
    }
    broadcast(FUNDET_PUSH.AGENT_EVENT, { sessionId: session.id, event });
  });

  session.onStatusChange((status) => {
    broadcast(FUNDET_PUSH.AGENT_STATUS_CHANGED, { sessionId: session.id, status });
  });

  session.setInteractionListener((request) => interactionQueue.enqueue(session.id, request));

  session.onStatusChange((status) => {
    if (status === 'closed' || status === 'error') {
      wiredSessions.delete(session.id);
      lastAssistantFinal.delete(session.id);
    }
  });
}

/** 取内存中的会话；不存在时按 create 参数或 DB 记录 lazy-create */
export async function ensureSession(input: SessionSendInput): Promise<Session> {
  const { maker } = getHost();
  const alive = maker.getSession(input.sessionId);
  if (alive) return alive;

  const create = input.create;
  if (!create) {
    const row = getDb().select().from(sessions).where(eq(sessions.id, input.sessionId)).get();
    if (!row) throw new Error(`会话不存在且未提供创建参数: ${input.sessionId}`);
    // 从 DB 恢复会话参数（providerId 不在 SessionMeta 里 —— 本阶段重建需 renderer 传 create）
    throw new Error(
      `会话 ${input.sessionId} 不在内存（model=${row.model}）。请带 create 参数重发，或新建会话。`,
    );
  }
  // workDir 不存在时 pi spawn 会 ENOENT——提前拦截并给中文指引
  if (create.workDir && !fs.existsSync(path.resolve(create.workDir))) {
    throw new Error(
      '工作目录不存在：' + create.workDir + '。可能已被移动或删除，请用输入框旁的文件夹按钮重新选择。',
    );
  }
  const session = await maker.createSession({
    agentKind: 'pi',
    id: create.sessionId ?? input.sessionId,
    title: create.title,
    workingDir: create.workDir,
    model: create.model,
    providerId: create.providerId,
    effort: create.effort,
    permissionMode: create.permissionMode,
  });
  wireSession(session);
  return session;
}

/** 首条用户消息自动标题时要覆盖的占位值（renderer 建草稿时写入「新对话」） */
const PLACEHOLDER_TITLES = new Set(['', '新会话', '新对话']);

/** 首条用户消息落库时，用消息前 20 字做会话标题（不用 LLM）；仅覆盖占位标题 */
export function autoTitleFromFirstMessage(sessionId: string, text: string): void {
  try {
    const row = getDb()
      .select({ title: sessions.title })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    if (!row || !PLACEHOLDER_TITLES.has(row.title)) return;
    const title = text.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!title) return;
    getDb().update(sessions).set({ title, updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
  } catch (err) {
    console.warn('[fundet:ipc] 自动标题失败（不阻断发送）', err);
  }
}

export function settleInteraction(requestId: string, decision: InteractionDecision): boolean {
  return interactionQueue.settle(requestId, decision);
}

/** INTERACTION_GET_PENDING 用的待决清单（跨会话） */
export function listPendingInteractions(): Array<{ sessionId: string; request: InteractionRequest }> {
  return interactionQueue.list();
}

/**
 * 发送前的 UserMessage 组装：知识库前缀块（只进模型消息，不进用户气泡/落库）+
 * 附件 image/file 块 + 文档正文提取块。
 */
export async function buildUserMessage(
  text: string,
  attachments?: SessionAttachment[],
  knowledgeContext?: string,
): Promise<UserMessage> {
  const files = attachments ?? [];
  const kbPrefix = knowledgeContext?.trim()
    ? `【知识库检索结果——以下是用户知识库中与问题相关的原文片段，回答时优先依据并注明来源文件】\n\n${knowledgeContext.trim()}\n\n---\n\n`
    : '';
  if (files.length === 0) return { type: 'user', content: kbPrefix + text };
  const blocks: UserContentBlock[] = [];
  if (kbPrefix || text.trim()) blocks.push({ type: 'text', text: kbPrefix + text });
  // 多篇 PDF/Word 并行提取（串行时大文件会拖慢整条发送）；保持每个
  // file 块后紧跟自己的正文块，配对顺序不变
  const extracted = await Promise.all(
    files.map(async (a) =>
      a.kind !== 'image' && documentExtractSupport(a.path)
        ? await extractDocumentText(a.path)
        : '',
    ),
  );
  files.forEach((a, i) => {
    if (a.kind === 'image') {
      blocks.push({ type: 'image', path: a.path, mimeType: a.mimeType });
    } else {
      blocks.push({ type: 'file', path: a.path, mimeType: a.mimeType });
      if (extracted[i]) blocks.push({ type: 'text', text: extracted[i] });
    }
  });
  return { type: 'user', content: blocks };
}
