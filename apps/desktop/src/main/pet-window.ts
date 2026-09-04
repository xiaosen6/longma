/**
 * 桌宠窗口：透明置顶小窗，加载主 renderer 的 #/pet 路由。
 * 状态数据由 renderer 内的 sessionStore 直接订阅（复用主 preload 的 fundet API），
 * 这里只负责窗口生命周期、位置记忆与拖拽 setBounds。
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const PET_SIZE = 160;
const STATE_FILE = () => path.join(app.getPath('userData'), 'pet-window.json');

let petWin: BrowserWindow | null = null;
let petEnabled = false;

interface PetState {
  enabled: boolean;
  x?: number;
  y?: number;
}

function readState(): PetState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf-8')) as PetState;
  } catch {
    return { enabled: false };
  }
}

function writeState(patch: Partial<PetState>): void {
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...readState(), ...patch }));
  } catch {
    /* 非致命：位置记忆失败不影响功能 */
  }
}

/** 默认出生点：主屏右下角（任务栏上方留白） */
function defaultPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - PET_SIZE - 24,
    y: workArea.y + workArea.height - PET_SIZE - 24,
  };
}

function createPetWindow(preloadPath: string): BrowserWindow {
  const state = readState();
  const pos = state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : defaultPosition();
  // 防止记忆位置落在已拔掉的显示器外
  const onSomeScreen = screen.getAllDisplays().some((d) => {
    const { x, y, width, height } = d.workArea;
    return pos.x >= x - PET_SIZE && pos.x <= x + width && pos.y >= y - PET_SIZE && pos.y <= y + height;
  });
  const finalPos = onSomeScreen ? pos : defaultPosition();

  return new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    x: finalPos.x,
    y: finalPos.y,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: { preload: preloadPath },
  });
}

/** 开关桌宠。loadPetUrl：给窗口加载 #/pet 页面（主进程注入 dev/file 地址差异）。 */
export function togglePetWindow(loadPetUrl: (win: BrowserWindow) => void, preloadPath: string): boolean {
  if (petWin && !petWin.isDestroyed()) {
    petWin.close();
    petWin = null;
    petEnabled = false;
    writeState({ enabled: false });
    return false;
  }
  petWin = createPetWindow(preloadPath);
  loadPetUrl(petWin);
  petWin.once('ready-to-show', () => petWin?.show());
  petWin.on('closed', () => {
    petWin = null;
  });
  petWin.on('moved', () => {
    const [x, y] = petWin?.getPosition() ?? [0, 0];
    writeState({ x, y });
  });
  petEnabled = true;
  writeState({ enabled: true });
  return true;
}

export function isPetWindowAlive(): boolean {
  return petWin !== null && !petWin.isDestroyed();
}

export function isPetEnabledInState(): boolean {
  return readState().enabled === true;
}

export function registerPetIpc(focusMain: () => void): void {
  ipcMain.handle('pet:set-bounds', (_e, x: number, y: number) => {
    if (!petWin || petWin.isDestroyed()) return;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    // 钳制到主屏工作区内（防拖丢）
    const { workArea } = screen.getPrimaryDisplay();
    const cx = Math.min(Math.max(x, workArea.x - PET_SIZE / 2), workArea.x + workArea.width - PET_SIZE / 2);
    const cy = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - PET_SIZE / 2);
    petWin.setBounds({ x: Math.round(cx), y: Math.round(cy) });
    const [fx, fy] = petWin.getPosition();
    writeState({ x: fx, y: fy });
  });
  ipcMain.handle('pet:open-main', () => {
    focusMain();
  });
}
