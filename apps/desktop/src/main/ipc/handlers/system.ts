/** 系统域 IPC：文件选择/staging/读取、外链、窗口控制、剪贴板。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, shell } from 'electron';
import { FUNDET_INVOKE } from '../channels.js';
import { resolveUnderWorkDir, stageBytesIntoWorkDir, stageFileIntoWorkDir } from '../../fs-local.js';
import { mimeFromExt } from '../../../shared/file-kind.ts';

export function registerSystemHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.FS_HOME, async () => os.homedir());
  ipcMain.handle(FUNDET_INVOKE.FS_PICK_DIR, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '选择工作目录',
      properties: ['openDirectory' as const, 'createDirectory' as const],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths[0]) return null;
    return picked.filePaths[0];
  });

  ipcMain.handle(FUNDET_INVOKE.FS_PICK_FILES, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '选择文件',
      properties: ['openFile' as const, 'multiSelections' as const],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return picked.filePaths;
  });

  ipcMain.handle(FUNDET_INVOKE.FS_STAGE_FILES, async (_e, workDir: string, paths: string[]) => {
    if (!Array.isArray(paths) || paths.length === 0) return [];
    const out = [];
    for (const p of paths) out.push(await stageFileIntoWorkDir(String(p), workDir));
    return out;
  });

  ipcMain.handle(
    FUNDET_INVOKE.FS_STAGE_BYTES,
    async (_e, workDir: string, name: string, data: ArrayBuffer) => {
      return stageBytesIntoWorkDir(workDir, String(name || 'paste'), new Uint8Array(data));
    },
  );

  ipcMain.handle(FUNDET_INVOKE.FS_PICK_IMAGE, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '选择头像',
      properties: ['openFile' as const],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    };
    const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths[0]) return null;
    const filePath = picked.filePaths[0];
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('不是文件');
    if (stat.size > 4 * 1024 * 1024) throw new Error('头像超过 4MB');
    const buf = fs.readFileSync(filePath);
    const mime = mimeFromExt(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle(FUNDET_INVOKE.FS_READ_TEXT, async (_e, filePath: string, workDir: string) => {
    const resolved = resolveUnderWorkDir(filePath, workDir);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('不是文件');
    if (stat.size > 2 * 1024 * 1024) throw new Error('文件超过 2MB，请用系统打开');
    return fs.readFileSync(resolved, 'utf-8');
  });

  ipcMain.handle(FUNDET_INVOKE.FS_READ_DATA_URL, async (_e, filePath: string, workDir: string) => {
    const resolved = resolveUnderWorkDir(filePath, workDir);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('不是文件');
    if (stat.size > 8 * 1024 * 1024) throw new Error('图片超过 8MB');
    const buf = fs.readFileSync(resolved);
    const mime = mimeFromExt(resolved);
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle(FUNDET_INVOKE.FS_OPEN_PATH, async (_e, filePath: string) => {
    const resolved = path.resolve(filePath);
    const err = await shell.openPath(resolved);
    if (err) throw new Error(err);
  });

  ipcMain.handle(FUNDET_INVOKE.OPEN_EXTERNAL, async (_e, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(String(url));
    } catch {
      throw new Error('无效链接');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('只允许打开 http(s) 链接');
    }
    await shell.openExternal(parsed.toString());
  });

  ipcMain.on(FUNDET_INVOKE.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on(FUNDET_INVOKE.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(FUNDET_INVOKE.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(FUNDET_INVOKE.CLIPBOARD_WRITE_TEXT, (_e, text: string) => {
    clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''));
  });

  ipcMain.handle(
    FUNDET_INVOKE.CLIPBOARD_CAPTURE_RECT,
    async (
      e,
      rect: { x?: number; y?: number; width?: number; height?: number },
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) throw new Error('窗口不存在');
      const bounds = {
        x: Math.max(0, Math.round(Number(rect?.x) || 0)),
        y: Math.max(0, Math.round(Number(rect?.y) || 0)),
        width: Math.max(1, Math.round(Number(rect?.width) || 0)),
        height: Math.max(1, Math.round(Number(rect?.height) || 0)),
      };
      const image = await win.webContents.capturePage(bounds);
      if (image.isEmpty()) throw new Error('截图为空');
      // Electron 44 移除 clipboard.writeImage；多格式剪贴板 API：ClipboardItem（MIME → Blob）。
      // Buffer 泛型与 BlobPart 不兼容，拷贝进全新 Uint8Array。
      const png = image.toPNG();
      const bytes = new Uint8Array(png.byteLength);
      bytes.set(png);
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
      ]);
    },
  );
}
