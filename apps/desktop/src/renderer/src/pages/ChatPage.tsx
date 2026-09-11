/**
 * ChatPage — 会话页：固定两栏（Sidebar 260px + 聊天主区）。
 *
 * 主区：slim 头部（ChatHeader）→ MessageStream → composer。
 * 上下文圆环在输入卡下方右侧（对齐 Cindy ChatInput 底栏）。
 * composer 在有悬挂审批时被 PermissionPrompt 替换。
 *
 * 发送复活逻辑：会话不在 main 内存（应用重启后打开旧会话）时，按 DB 行的
 * model 在 providers 里反查 providerId，带 create 参数重发让 main lazy-create。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelRight } from 'lucide-react';
import type { Effort, PermissionMode } from '@fundet/agent-core';
import type { ProviderView, SessionAttachment, SkillView, KnowledgeRef } from '../../../shared/fundet-api.ts';
import type { SlashItem } from '../components/SlashPalette';
import {
  abortSession,
  deleteAssistantTurn,
  deleteDraftSession,
  ensureDraftSession,
  ensureHistory,
  forkSessionAt,
  getDraftProviderId,
  getDraftSession,
  isDraftSession,
  refreshSessionList,
  renameSession,
  resolvePermission,
  sendMessage,
  updateDraftSession,
  useRunningIds,
  useSessionList,
  useSessionSlice,
} from '../stores/sessionStore';
import {
  getDefaultWorkDir,
  getLastModel,
  getLastProviderId,
  rememberModelChoice,
  setDefaultWorkDir,
} from '../lib/defaults';
import { ChatInput } from '../components/ChatInput';
import { MessageStream } from '../components/MessageStream';
import { PermissionPrompt } from '../components/PermissionPrompt';
import { RunningStatus } from '../components/RunningStatus';
import { ModelSelector, PermissionSelector } from '../components/SelectorChips';
import { KnowledgeChip } from '../components/KnowledgeChip';
import { FolderPickerChip } from '../components/FolderPickerChip';
import { Sidebar } from '../components/Sidebar';
import { CanvasPane } from '../components/CanvasPane';
import { ContextCapacityRing } from '../components/ContextCapacityRing';
import { hasFramelessControls } from '../components/WindowControls';
import { preferScannedContextWindow } from '../../../shared/context-window.js';
import { addRecentFolder } from '../lib/recentFolders';
import { dataTransferHasFiles, filesFromDataTransfer } from '../lib/file-drop';
import { cn } from '../lib/cn';
import { useSidebarResize } from './chat/useSidebarResize';
import { useCanvasTracker } from './chat/useCanvasTracker';
import { useAttachments } from './chat/useAttachments';
import { usePetShots } from './chat/usePetShots';
import { ChatEmptyState } from './chat/ChatEmptyState';
import { ChatHeader } from './chat/ChatHeader';

export function ChatPage(): React.JSX.Element {
  const sessions = useSessionList();
  const runningIds = useRunningIds();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
  /** @知识库点名：选中的知识库（null=关闭注入）；localStorage 记住上次选择 */
  const [kbInjectBaseId, setKbInjectBaseId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('kb-inject-base-id');
    } catch {
      return null;
    }
  });

  const { sidebarWidth, startSidebarResize } = useSidebarResize();
  const [workDir, setWorkDir] = useState(getDefaultWorkDir);
  const [attachmentsState, setAttachmentsState] = useState<SessionAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  const slice = useSessionSlice(activeId);

  const activeMeta = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? getDraftSession(activeId) ?? null,
    [sessions, activeId],
  );

  const canvas = useCanvasTracker(slice.items, attachmentsState);
  const sessionWorkDir = activeMeta?.workDir || workDir;

  const stagedToCanvas = useCallback((p: string) => {
    canvas.setCanvasPath(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅引用 setter，稳定引用
  }, []);
  const attach = useAttachments(sessionWorkDir, setNotice, stagedToCanvas);
  const { attachments, mergeAttachments, stagePaths, addDroppedFiles, pickFiles } = attach;

  // 桌宠截图问答：主进程已把截图落盘（切页不丢），这里归一到当前会话工作目录
  // （stageFiles 对目录内文件零拷贝引用、目录外文件拷进 .longma-uploads）再挂输入区
  const acceptPetShots = useCallback(
    async (list: SessionAttachment[]): Promise<void> => {
      const dir = sessionWorkDir.trim();
      if (!dir) {
        setNotice('请先选择工作目录');
        return;
      }
      const staged = await window.fundet.stageFiles(dir, list.map((a) => a.path));
      mergeAttachments(staged);
    },
    [mergeAttachments, sessionWorkDir],
  );
  const { petFocusTick } = usePetShots(acceptPetShots, setNotice);

  // 切会话：重置画布/附件/拖拽态
  useEffect(() => {
    canvas.reset();
    attach.reset();
    setDragOver(false);
    dragCountRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 切会话时整体重置
  }, [activeId]);

  const modelSpec = useMemo(() => {
    const id = activeMeta?.model;
    if (!id) return undefined;
    for (const p of providers) {
      const found = p.models.find((m) => m.id === id);
      if (found) return found;
    }
    return undefined;
  }, [providers, activeMeta?.model]);
  const shownWindow = activeMeta?.model
    ? preferScannedContextWindow(activeMeta.model, modelSpec?.contextWindow) ?? 0
    : 0;

  useEffect(() => {
    void window.fundet.listProviders().then(setProviders);
    void (async () => {
      if (getDefaultWorkDir().trim()) return;
      const home = await window.fundet.userHome();
      if (!home) return;
      addRecentFolder(home);
      setDefaultWorkDir(home);
      setWorkDir(home);
    })();
  }, []);

  useEffect(() => {
    const dir = activeMeta?.workDir || getDefaultWorkDir();
    void window.fundet.listSkills(dir || undefined).then(setSkills);
  }, [activeMeta?.workDir]);

  const slashItems = useMemo<SlashItem[]>(() => {
    const skillItems: SlashItem[] = skills.map((s) => ({
      id: `skill:${s.path}`,
      label: s.name,
      hint: s.description,
      insert: `/skill:${s.name}`,
      kind: 'skill',
    }));
    return skillItems;
  }, [skills]);

  // 切会话：重建历史（仅首次）
  useEffect(() => {
    if (activeId) void ensureHistory(activeId);
  }, [activeId]);

  // ---------- 会话动作 ----------

  // 新建会话只建本地草稿（不调 session:create、不 spawn pi）；
  // 首条消息 send 时由 main 侧 lazy-create 落 DB + 起进程。
  const applyWorkDir = useCallback(
    (picked: string): void => {
      addRecentFolder(picked);
      setDefaultWorkDir(picked);
      setWorkDir(picked);
      if (activeId && isDraftSession(activeId)) {
        updateDraftSession(activeId, { workDir: picked });
      }
    },
    [activeId],
  );

  const createSession = useCallback((): void => {
    setNotice('');
    setInput('');
    const dir = workDir.trim() || getDefaultWorkDir();
    if (!dir) {
      setNotice('请先选择工作目录');
      return;
    }
    const provider =
      providers.find((p) => p.id === getLastProviderId()) ?? providers[0];
    const model =
      provider?.models.find((m) => m.id === getLastModel())?.id ?? provider?.models[0]?.id;
    if (!provider || !model) {
      setNotice('请先在设置页配置 provider 和模型');
      return;
    }
    const meta = ensureDraftSession({
      workDir: dir,
      providerId: provider.id,
      model,
      title: '新对话',
    });
    rememberModelChoice(provider.id, model);
    setActiveId(meta.id);
  }, [providers, workDir]);

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      // 草稿在 main/DB 里不存在，纯本地移除即可
      if (isDraftSession(id)) {
        deleteDraftSession(id);
        if (activeId === id) setActiveId(null);
        return;
      }
      await window.fundet.deleteSession(id);
      if (activeId === id) setActiveId(null);
      await refreshSessionList();
    },
    [activeId],
  );

  // ---------- 发送 / 中断 ----------

  // 终态错误卡的「重新发送」：重发本轮最后一条用户消息（含附件路径引用）
  const resendLast = useCallback((): void => {
    if (!activeId) return;
    const lastUser = [...slice.items].reverse().find((it) => it.kind === 'user');
    if (!lastUser || lastUser.kind !== 'user') return;
    void (async () => {
      try {
        await window.fundet.sendMessage({
          sessionId: activeId,
          text: lastUser.text,
          ...(lastUser.attachments && lastUser.attachments.length > 0
            ? { attachments: lastUser.attachments }
            : {}),
        });
      } catch (err) {
        setNotice(`重新发送失败：${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [activeId, slice.items]);

  const send = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!activeId || (!text && attachments.length === 0)) return;
    const pending = attachments;
    setInput('');
    setAttachmentsState([]);
    setNotice('');
    // @知识库点名：检索选中库并把原文片段注入模型消息（强制 RAG，不依赖模型调工具）；
    // 注入内容只进模型消息，用户气泡与落库保持原文；kbRefs 随消息落库供回复角标溯源
    let knowledgeContext: string | undefined;
    let kbRefs: KnowledgeRef[] | undefined;
    if (kbInjectBaseId && text) {
      try {
        const results = await window.fundet.searchKnowledge(text, kbInjectBaseId, 6);
        if (results.length > 0) {
          const parts = results.map((r, i) => `[${i + 1}] 来源：${r.itemName}（第 ${r.seq + 1} 块）\n${r.text}`);
          knowledgeContext = parts.join('\n\n');
          kbRefs = results.map((r) => ({
            itemName: r.itemName,
            seq: r.seq,
            text: r.text,
            baseId: r.baseId,
            baseName: r.baseName,
          }));
        }
      } catch {
        // 检索失败不阻断发送——模型仍可走 mcp__knowledge__search 自主检索
      }
    }
    // 重启后旧会话 / 本地草稿都不在 main 内存：带 create 让 main lazy-create。
    // 草稿有精确的 providerId；历史会话按 model 在 providers 里反查。
    let create: Parameters<typeof sendMessage>[2];
    if (activeMeta) {
      const draftProviderId = getDraftProviderId(activeId);
      const provider = draftProviderId
        ? providers.find((p) => p.id === draftProviderId)
        : providers.find((p) => p.models.some((m) => m.id === activeMeta.model));
      if (provider) {
        create = {
          sessionId: activeId,
          workDir: activeMeta.workDir,
          providerId: provider.id,
          model: activeMeta.model,
          title: activeMeta.title,
          // 草稿上选的权限档位随首条消息一起落库（历史会话该值本就已在 DB）
          ...(activeMeta.permissionMode
            ? { permissionMode: activeMeta.permissionMode as PermissionMode }
            : {}),
          // effort 同理：死会话落库的档位要在 lazy-create 时带上
          ...(activeMeta.effort ? { effort: activeMeta.effort as Effort } : {}),
        };
      }
    }
    await sendMessage(activeId, text, create, pending.length > 0 ? pending : undefined, knowledgeContext, kbRefs);
  }, [activeId, activeMeta, attachments, input, providers, kbInjectBaseId]);

  const abort = useCallback(async (): Promise<void> => {
    if (activeId) await abortSession(activeId);
  }, [activeId]);

  // ---------- composer chips ----------

  const selectModel = useCallback(
    async (providerId: string, modelId: string): Promise<void> => {
      if (!activeId) return;
      rememberModelChoice(providerId, modelId);
      // 草稿还没有 main 侧会话，只改本地；首条消息 send 时随 create 参数生效
      if (isDraftSession(activeId)) {
        updateDraftSession(activeId, { providerId, model: modelId });
        return;
      }
      try {
        await window.fundet.setSessionModel(activeId, modelId, providerId);
        await refreshSessionList();
      } catch (err) {
        setNotice(`切换模型失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeId],
  );

  const permissionMode = (activeMeta?.permissionMode as PermissionMode | null) ?? 'ask';
  const selectPermission = useCallback(
    async (mode: PermissionMode): Promise<void> => {
      if (!activeId) return;
      // 草稿同上：纯本地
      if (isDraftSession(activeId)) {
        updateDraftSession(activeId, { permissionMode: mode });
        return;
      }
      try {
        await window.fundet.setSessionPermissionMode(activeId, mode);
        await refreshSessionList();
      } catch (err) {
        setNotice(`切换权限档位失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeId],
  );

  // ---------- 渲染 ----------

  const pendingPermission =
    slice.pendingInteraction?.kind === 'permission' ? slice.pendingInteraction : null;

  // 无可用模型（没配 provider / 草稿没选到模型）：发送禁用（对齐 cindy-09 的
  // 禁用态，不报错）；空态下再叠一张内联引导面板（对齐 cindy-02 的 Connect 面板）。
  const noModel = providers.length === 0 || !activeMeta?.model;

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        runningIds={runningIds}
        onSelect={setActiveId}
        onCreate={() => void createSession()}
        onDelete={(id) => void deleteSession(id)}
        onRename={async (id, title) => {
          try {
            await renameSession(id, title);
          } catch (err) {
            setNotice(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
          }
        }}
        showNewHint={sessions.length === 0 && !activeId}
        width={sidebarWidth}
        onResizeStart={startSidebarResize}
      />

      {/* Canvas 开关钉在窗口右上（WindowControls 左侧），不随主列/Canvas 面板
          宽度变化漂移——对齐 Cindy「折叠 toggle 钉在窗口层，不跟面板跑」 */}
      {activeId && (
        <button
          type="button"
          title="Canvas"
          onClick={() => canvas.setCanvasOpen((v) => !v)}
          className={cn(
            'no-drag fixed top-0 z-40 flex h-[46px] w-10 items-center justify-center hover:bg-hover',
            hasFramelessControls() ? 'right-[138px]' : 'right-0',
            canvas.canvasOpen ? 'text-primary' : 'text-muted',
          )}
        >
          <PanelRight size={14} />
        </button>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {!activeId ? (
          <ChatEmptyState
            hasProvider={providers.length > 0}
            workDir={workDir}
            notice={notice}
            onPickDir={applyWorkDir}
            onCreate={() => void createSession()}
          />
        ) : (
          <div
            className="relative flex min-h-0 min-w-0 flex-1"
            onDragEnter={(e) => {
              if (!dataTransferHasFiles(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              dragCountRef.current += 1;
              setDragOver(true);
            }}
            onDragOver={(e) => {
              if (!dataTransferHasFiles(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragCountRef.current = Math.max(0, dragCountRef.current - 1);
              if (dragCountRef.current === 0) setDragOver(false);
            }}
            onDrop={(e) => {
              if (!dataTransferHasFiles(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              dragCountRef.current = 0;
              setDragOver(false);
              const { files, skippedDirectory } = filesFromDataTransfer(e.dataTransfer);
              if (skippedDirectory) setNotice('暂不支持拖入文件夹，请拖文件或改工作目录');
              if (files.length > 0) void addDroppedFiles(files);
            }}
          >
            {dragOver && (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-none border-2 border-dashed border-[var(--focus-ring)]"
                style={{ backgroundColor: 'color-mix(in srgb, var(--focus-ring) 10%, transparent)' }}
              >
                <div className="rounded-container border border-board bg-card px-4 py-2 text-13 text-primary">
                  放到这里，发给助手
                </div>
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ChatHeader
                sessionId={activeId}
                title={activeMeta?.title ?? ''}
                workDir={activeMeta?.workDir ?? null}
                onRename={async (title) => {
                  if (!activeId) return;
                  try {
                    await renameSession(activeId, title);
                  } catch (err) {
                    setNotice(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
                    throw err;
                  }
                }}
              />

              <MessageStream
                sessionId={activeId ?? '__draft__'}
                slice={slice}
                workDir={activeMeta?.workDir || workDir}
                onOpenFile={canvas.openCanvas}
                canFork={Boolean(activeId) && !isDraftSession(activeId)}
                onFork={async (createdAt) => {
                  if (!activeId) return;
                  try {
                    const id = await forkSessionAt(activeId, createdAt);
                    setActiveId(id);
                  } catch (err) {
                    setNotice(`分叉失败：${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
                onAddToChat={(text) => {
                  const quote = text
                    .trim()
                    .split('\n')
                    .map((line) => `> ${line}`)
                    .join('\n');
                  setInput((prev) => {
                    const p = prev.trimEnd();
                    return p ? `${p}\n\n${quote}\n\n` : `${quote}\n\n`;
                  });
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLTextAreaElement>('main textarea')?.focus();
                  });
                }}
                onDelete={async (assistantId) => {
                  if (!activeId) return;
                  if (!window.confirm('删除这条回复及其工作过程？此操作不可撤销。')) return;
                  try {
                    await deleteAssistantTurn(activeId, assistantId);
                  } catch (err) {
                    setNotice(`删除失败：${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
                onRetryError={resendLast}
              />

              {/* composer：审批悬挂时换成 PermissionPrompt；运行状态行在输入卡上方 */}
              <div className="px-6 pt-1 pb-4">
                <div className="mx-auto flex max-w-[820px] flex-col">
                  {notice && <div className="pb-1 text-12 text-error">{notice}</div>}
                  {pendingPermission ? (
                    <PermissionPrompt
                      request={pendingPermission}
                      onRespond={(behavior) =>
                        void resolvePermission(activeId, pendingPermission, behavior)
                      }
                    />
                  ) : (
                    <>
                      <RunningStatus
                        visible={slice.isRunning}
                        status={slice.statusText}
                        tokenUsage={slice.usage.tokenUsage}
                      />
                      <ChatInput
                        value={input}
                        onChange={setInput}
                        onSend={() => void send()}
                        onAbort={() => void abort()}
                        isRunning={slice.isRunning}
                        sendDisabled={noModel}
                        slashItems={slashItems}
                        placeholder={noModel ? '先在设置页添加 Provider，再开始对话…' : '输入消息，或拖入文件…'}
                        attachments={attachments}
                        onRemoveAttachment={(p) =>
                          setAttachmentsState((prev) => prev.filter((a) => a.path !== p))
                        }
                        onAddFiles={(files) => void addDroppedFiles(files)}
                        onPickFiles={() => void pickFiles()}
                        focusSignal={petFocusTick}
                        dragOver={dragOver}
                        leadingControls={
                          <>
                            <FolderPickerChip
                              cwd={activeMeta?.workDir || workDir}
                              onSelect={applyWorkDir}
                            />
                            <KnowledgeChip
                              selectedBaseId={kbInjectBaseId}
                              onSelect={(id) => {
                                setKbInjectBaseId(id);
                                try {
                                  if (id) localStorage.setItem('kb-inject-base-id', id);
                                  else localStorage.removeItem('kb-inject-base-id');
                                } catch {
                                  /* localStorage 不可用时仅会话内生效 */
                                }
                              }}
                            />
                            <PermissionSelector
                              current={permissionMode}
                              onSelect={(m) => void selectPermission(m)}
                            />
                          </>
                        }
                        trailingControls={
                          <ModelSelector
                            providers={providers}
                            currentModel={activeMeta?.model ?? ''}
                            onSelect={(pid, mid) => void selectModel(pid, mid)}
                          />
                        }
                      />
                    </>
                  )}
                  {/* Cindy：用量环在输入卡下方右侧，不在顶栏 */}
                  <div className="mt-1.5 flex w-full items-center justify-end gap-3 px-1">
                    {slice.usage.costUsd > 0 && (
                      <span className="text-12 tabular-nums text-muted">
                        ${slice.usage.costUsd.toFixed(4)}
                      </span>
                    )}
                    {activeId && !activeId.startsWith('draft-') && (
                      <span
                        className="font-mono text-10 text-muted select-text"
                        title={'会话 ID：' + activeId}
                      >
                        {activeId.slice(0, 8)}
                      </span>
                    )}
                    <ContextCapacityRing
                      contextTokens={slice.usage.contextTokens}
                      contextWindow={shownWindow}
                    />
                  </div>
                </div>
              </div>
            </div>
            {canvas.canvasOpen && (
              <CanvasPane
                workDir={activeMeta?.workDir || workDir}
                artifacts={canvas.artifacts}
                activePath={canvas.canvasPath}
                onSelect={canvas.setCanvasPath}
                onClose={() => canvas.setCanvasOpen(false)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
