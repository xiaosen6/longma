/** 知识库域 IPC：库/条目 CRUD、文件/目录/网页导入、检索、重试。 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import {
  addKnowledgeFiles,
  addKnowledgeUrl,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeItem,
  listKnowledgeBases,
  listKnowledgeItems,
  refetchKnowledgeItem,
  retryKnowledgeItem,
  scanKnowledgeDirectory,
  searchKnowledge,
} from '../../knowledge/service.js';
import { FUNDET_INVOKE } from '../channels.js';

export function registerKnowledgeHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.KB_LIST, async () => listKnowledgeBases());
  ipcMain.handle(FUNDET_INVOKE.KB_CREATE, async (_e, name: string) => createKnowledgeBase(String(name)));
  ipcMain.handle(FUNDET_INVOKE.KB_DELETE, async (_e, id: string) => deleteKnowledgeBase(String(id)));
  ipcMain.handle(FUNDET_INVOKE.KB_ITEMS, async (_e, baseId: string) => listKnowledgeItems(String(baseId)));
  ipcMain.handle(FUNDET_INVOKE.KB_ADD_FILES, async (_e, baseId: string, paths: string[]) => {
    const list = Array.isArray(paths) ? paths.map(String) : [];
    if (list.length === 0) throw new Error('未选择文件');
    return addKnowledgeFiles(String(baseId), list);
  });
  ipcMain.handle(FUNDET_INVOKE.KB_REMOVE_ITEM, async (_e, itemId: string) => deleteKnowledgeItem(String(itemId)));
  ipcMain.handle(
    FUNDET_INVOKE.KB_SEARCH,
    async (_e, query: string, baseId?: string, limit?: number) =>
      searchKnowledge(String(query ?? ''), baseId ? String(baseId) : undefined, Number(limit) || 6),
  );
  ipcMain.handle(FUNDET_INVOKE.KB_PICK_FILES, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '导入文档到知识库',
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [{ name: '文档', extensions: ['md', 'txt', 'pdf', 'docx'] }],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled) return null;
    return picked.filePaths;
  });
  ipcMain.handle(FUNDET_INVOKE.KB_RETRY, async (_e, itemId: string) => retryKnowledgeItem(String(itemId)));
  ipcMain.handle(FUNDET_INVOKE.KB_PICK_DIRECTORY, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { title: '选择要导入的文件夹', properties: ['openDirectory' as const] };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths[0]) return null;
    return picked.filePaths[0];
  });
  ipcMain.handle(FUNDET_INVOKE.KB_ADD_DIRECTORY, async (_e, baseId: string, dirPath: string) => {
    const files = scanKnowledgeDirectory(String(dirPath));
    if (files.length === 0) throw new Error('该目录下没有支持的文档（md / txt / pdf / docx）');
    return addKnowledgeFiles(String(baseId), files);
  });
  ipcMain.handle(FUNDET_INVOKE.KB_ADD_URL, async (_e, baseId: string, url: string) =>
    addKnowledgeUrl(String(baseId), String(url)));
  ipcMain.handle(FUNDET_INVOKE.KB_REFETCH, async (_e, itemId: string) => refetchKnowledgeItem(String(itemId)));
}
