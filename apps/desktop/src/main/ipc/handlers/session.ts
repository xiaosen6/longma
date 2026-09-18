/** 会话域 IPC：生命周期、发送、模型/权限切换、审批、用量历史。 */
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { Effort, InteractionDecision, PermissionMode } from '@fundet/agent-core';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { sessions, settings } from '../../db/schema.js';
import { copyMessagesUntil, deleteMessagesInRange, insertMessage, listMessages } from '../../db/messages.js';
import { getUsageHistory } from '../../db/usage.js';
import { deleteMessagesForSession } from '../../db/messages.js';
import { listProviders } from '../../db/providers.js';
import { getHost } from '../../host/pi-host.js';
import { FUNDET_INVOKE } from '../channels.js';
import {
  autoTitleFromFirstMessage,
  buildUserMessage,
  clearInterruptedTurnSession,
  ensureSession,
  listInterruptedTurnSessions,
  listPendingInteractions,
  markTurnRunning,
  settleInteraction,
  wireSession,
} from '../session-core.js';
import type { SendResult, SessionCreateInput, SessionDetail, SessionListItem, SessionSendInput } from '../../../shared/fundet-api.js';

function sessionRowsToList(): SessionListItem[] {
  return getDb()
    .select()
    .from(sessions)
    .orderBy(desc(sessions.updatedAt))
    .all()
    .map((r) => ({
      id: r.id,
      title: r.title,
      workDir: r.workDir,
      model: r.model,
      effort: r.effort,
      permissionMode: r.permissionMode,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
}

export function registerSessionHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.SESSION_CREATE, async (_e, input: SessionCreateInput) => {
    const { maker } = getHost();
    const session = await maker.createSession({
      agentKind: 'pi',
      id: input.sessionId ?? randomUUID(),
      title: input.title,
      workingDir: input.workDir,
      model: input.model,
      providerId: input.providerId,
      effort: input.effort,
      permissionMode: input.permissionMode,
    });
    wireSession(session);
    const meta = await maker.getSessionMeta(session.id);
    return meta;
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_LIST, async () => sessionRowsToList());

  ipcMain.handle(FUNDET_INVOKE.SESSION_GET, async (_e, id: string): Promise<SessionDetail | null> => {
    const row = getDb().select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row) return null;
    return {
      meta: {
        id: row.id,
        title: row.title,
        workDir: row.workDir,
        model: row.model,
        effort: row.effort,
        permissionMode: row.permissionMode,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      messages: listMessages(id).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_DELETE, async (_e, id: string) => {
    const { maker } = getHost();
    if (maker.isSessionAlive(id)) await maker.closeSession(id, 'requested');
    getDb().delete(sessions).where(eq(sessions.id, id)).run();
  });

  ipcMain.handle(
    FUNDET_INVOKE.SESSION_SEND,
    async (_e, input: SessionSendInput): Promise<SendResult> => {
      const session = await ensureSession(input);
      const attachments = input.attachments ?? [];
      insertMessage(session.id, 'user', {
        text: input.text,
        ...(attachments.length > 0 ? { attachments } : {}),
        // 溯源角标：引用元数据随用户消息落库（气泡不显示；assistant 正文 [n] 据此渲染角标）
        ...(input.kbRefs && input.kbRefs.length > 0 ? { kbRefs: input.kbRefs } : {}),
      });
      autoTitleFromFirstMessage(
        session.id,
        input.text.trim() || attachments.map((a) => a.name).join(' ') || '',
      );
      const result = await session.send(await buildUserMessage(input.text, attachments, input.knowledgeContext));
      if (result.accepted) markTurnRunning(session.id);
      return result.accepted ? { accepted: true } : { accepted: false, reason: result.reason };
    },
  );

  ipcMain.handle(FUNDET_INVOKE.SESSION_ABORT, async (_e, id: string) => {
    const session = getHost().maker.getSession(id);
    if (session) await session.abort();
  });

  ipcMain.handle(
    FUNDET_INVOKE.SESSION_DELETE_TURN,
    async (_e, sessionId: string, afterCreatedAt: number, untilCreatedAt: number) => {
      deleteMessagesInRange(sessionId, afterCreatedAt, untilCreatedAt);
    },
  );

  ipcMain.handle(FUNDET_INVOKE.SESSION_FORK, async (_e, sessionId: string, upToCreatedAt: number) => {
    const row = getDb().select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!row) throw new Error('会话不存在');
    const providers = listProviders();
    const provider = providers.find((p) => p.models.some((m) => m.id === row.model)) ?? providers[0];
    if (!provider) throw new Error('没有可用的 Provider，无法分叉');
    const { maker } = getHost();
    const forked = await maker.createSession({
      agentKind: 'pi',
      title: `${row.title || '会话'}（分叉）`,
      workingDir: row.workDir,
      model: row.model,
      providerId: provider.id,
      effort: (row.effort as Effort | null) ?? undefined,
      permissionMode: (row.permissionMode as PermissionMode | null) ?? undefined,
    });
    wireSession(forked);
    copyMessagesUntil(sessionId, forked.id, upToCreatedAt);
    getDb().update(sessions).set({ updatedAt: Date.now() }).where(eq(sessions.id, forked.id)).run();
    return forked.id;
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_CLOSE, async (_e, id: string) => {
    const { maker } = getHost();
    if (maker.isSessionAlive(id)) await maker.closeSession(id, 'requested');
    getDb()
      .update(sessions)
      .set({ status: 'closed', updatedAt: Date.now() })
      .where(eq(sessions.id, id))
      .run();
  });

  ipcMain.handle(
    FUNDET_INVOKE.SESSION_SET_MODEL,
    async (_e, id: string, model: string, providerId?: string) => {
      const session = getHost().maker.getSession(id);
      if (session) {
        await session.setModel(model, providerId !== undefined ? { providerId } : undefined);
      } else {
        // 会话不在内存（重启后未发消息 / 上一轮出错被回收）：只落库，
        // 下次发送时 ensureSession 会按新 model lazy-create，不能在这里判死。
        const row = getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get();
        if (!row) throw new Error(`会话不存在: ${id}`);
      }
      getDb().update(sessions).set({ model, updatedAt: Date.now() }).where(eq(sessions.id, id)).run();
    },
  );

  ipcMain.handle(FUNDET_INVOKE.SESSION_SET_EFFORT, async (_e, id: string, effort: Effort | null) => {
    const session = getHost().maker.getSession(id);
    // null = 回模型默认：pi 的 set_thinking_level 没有 unset，活会话本轮保持
    // 当前档位，只清库让后续/lazy-create 的会话回到模型默认
    if (session && effort !== null) {
      await session.setEffort(effort);
    } else {
      const row = getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get();
      if (!row) throw new Error(`会话不存在: ${id}`);
    }
    getDb()
      .update(sessions)
      .set({ effort, updatedAt: Date.now() })
      .where(eq(sessions.id, id))
      .run();
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_SET_PERMISSION_MODE, async (_e, id: string, mode: PermissionMode) => {
    const session = getHost().maker.getSession(id);
    if (session) {
      await session.setPermissionMode(mode);
    } else {
      const row = getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get();
      if (!row) throw new Error(`会话不存在: ${id}`);
    }
    getDb()
      .update(sessions)
      .set({ permissionMode: mode, updatedAt: Date.now() })
      .where(eq(sessions.id, id))
      .run();
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_SET_TITLE, async (_e, id: string, title: string) => {
    const trimmed = String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!trimmed) throw new Error('标题不能为空');
    const row = getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get();
    if (!row) throw new Error('会话不存在');
    // 不 bump updatedAt：改名不应把会话顶到列表最前。
    getDb().update(sessions).set({ title: trimmed }).where(eq(sessions.id, id)).run();
  });

  // ---------- 审批 ----------
  ipcMain.handle(
    FUNDET_INVOKE.INTERACTION_RESOLVE,
    async (_e, requestId: string, decision: InteractionDecision) => {
      if (!settleInteraction(requestId, decision)) {
        throw new Error(`审批请求不存在或已解决: ${requestId}`);
      }
    },
  );

  ipcMain.handle(FUNDET_INVOKE.INTERACTION_GET_PENDING, async () => listPendingInteractions());

  // ---------- 侧栏置顶 ----------
  const PINNED_KEY = 'sidebar.pinned';
  ipcMain.handle(FUNDET_INVOKE.SIDEBAR_PINNED_GET, async (): Promise<string[]> => {
    const raw = getDb().select().from(settings).where(eq(settings.key, PINNED_KEY)).get();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw.value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  ipcMain.handle(FUNDET_INVOKE.SIDEBAR_PINNED_SET, async (_e, order: string[]) => {
    const clean = (Array.isArray(order) ? order : []).filter((x) => typeof x === 'string').slice(0, 10_000);
    const value = JSON.stringify(clean);
    getDb()
      .insert(settings)
      .values({ key: PINNED_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  });

  // ---------- 会话分支树 ----------
  ipcMain.handle(FUNDET_INVOKE.SESSION_TREE_GET, async (_e, id: string) => {
    const handle = getHost().maker.getSession(id);
    if (!handle?.getSessionTree) return null;
    try {
      return await handle.getSessionTree();
    } catch {
      return null;
    }
  });

  ipcMain.handle(FUNDET_INVOKE.SESSION_TREE_NAVIGATE, async (_e, id: string, entryId: string) => {
    const handle = getHost().maker.getSession(id);
    if (!handle?.navigateSessionTree) throw new Error('该会话不支持分支切换');
    const result = await handle.navigateSessionTree(entryId);
    // 分支切换后按 agent-core 给的安全时间线重写本会话消息（原线性行作废）
    deleteMessagesForSession(id);
    for (const m of result.messages) {
      const row = sessionTreeMessageToRow(m);
      if (row) insertMessage(id, row.role, row.content);
    }
    getDb().update(sessions).set({ updatedAt: Date.now() }).where(eq(sessions.id, id)).run();
  });

  // ---------- 中断回合提示 ----------
  ipcMain.handle(FUNDET_INVOKE.SESSION_GET_INTERRUPTED, async () => listInterruptedTurnSessions());
  ipcMain.handle(FUNDET_INVOKE.SESSION_CLEAR_INTERRUPTED, async (_e, id: string) => {
    clearInterruptedTurnSession(id);
  });

  // ---------- 用量历史 ----------
  ipcMain.handle(FUNDET_INVOKE.USAGE_HISTORY, async (_e, days?: number) => getUsageHistory(Math.min(90, Math.max(1, days ?? 30))));
}


/** SessionTreeHistoryMessage → messages 行（分支切换重写用）。
 *  content 形状 harness 中立：文本角色尽量抽字符串，抽不出落原始 JSON。 */
function sessionTreeMessageToRow(m: {
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'thinking';
  content: unknown;
  toolUseId?: string;
}): { role: string; content: unknown } | null {
  const textOf = (c: unknown): string | null => {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      const texts = c
        .map((b) => (typeof b === 'object' && b !== null && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
        .filter(Boolean);
      return texts.length > 0 ? texts.join('') : null;
    }
    return null;
  };
  switch (m.role) {
    case 'user':
    case 'assistant': {
      const text = textOf(m.content);
      return text != null ? { role: m.role, content: { text } } : null;
    }
    case 'thinking': {
      const text = textOf(m.content);
      return text != null ? { role: 'thinking', content: { text } } : null;
    }
    case 'tool_use':
    case 'tool_result':
      return { role: 'tool', content: { kind: m.role, data: { toolUseId: m.toolUseId, raw: m.content } } };
    default:
      return null;
  }
}
