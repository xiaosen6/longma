/**
 * 桌宠窗口：透明置顶小窗，加载独立的 resources/pet/pet.html（无主题 CSS/无 React）。
 * 状态数据由 pet.html 直接收主进程广播（agent:status-changed 广播到所有窗口），
 * 这里只负责窗口生命周期、位置记忆与拖拽 setBounds。
 *
 * 注意：transparent 窗必须「创建即显示」——show:false + 延迟 show 在 Windows
 * 上会失去透明（显示为背景色，2026-09-04 实测矩阵确认）。
 * ready-to-show 事件在 transparent 窗上也常不触发，不能等它。
 */
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const PET_SIZE = 160;
/** 审批气泡态窗口尺寸：pet 160 + 上方气泡区。透明区域会拦截鼠标，必须只在气泡可见期间扩 */
const PET_BUBBLE_WIDTH = 300;
const PET_BUBBLE_HEIGHT = 440;
const STATE_FILE = () => path.join(app.getPath('userData'), 'pet-window.json');

let petWin: BrowserWindow | null = null;
let petEnabled = false;
let bubbleActive = false;

interface PetState {
  enabled: boolean;
  theme: string;
  x?: number;
  y?: number;
}

function readState(): PetState {
  try {
    // pet-window.json 可能缺 theme 字段（旧版本写入）：必须回落默认，否则帧路径变 undefined
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf-8')) as Partial<PetState>;
    const defaults = { enabled: false, theme: 'black-heels' };
    return { ...defaults, ...parsed, theme: parsed.theme || defaults.theme } as PetState;
  } catch {
    return { enabled: false, theme: 'black-heels' };
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

/** 桌宠当前所在显示器的工作区（气泡扩窗要在同一块屏内钳制） */
function petWorkArea() {
  if (!petWin || petWin.isDestroyed()) return screen.getPrimaryDisplay().workArea;
  const [x, y] = petWin.getPosition();
  const [w, h] = petWin.getSize();
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hit = screen
    .getAllDisplays()
    .find((d) => cx >= d.bounds.x && cx <= d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy <= d.bounds.y + d.bounds.height);
  return (hit ?? screen.getPrimaryDisplay()).workArea;
}

/**
 * 审批气泡显隐 → 扩/缩窗口。pet 形象锚定窗口底部居中，扩窗向上生长、底边不动；
 * 收缩按当前窗口底边反推 160×160（气泡期间用户可能拖动过）。
 */
function setPetBubble(active: boolean): void {
  if (!petWin || petWin.isDestroyed() || active === bubbleActive) return;
  const b = petWin.getBounds();
  const workArea = petWorkArea();
  if (active) {
    const nx = Math.round(b.x + (b.width - PET_BUBBLE_WIDTH) / 2);
    let ny = Math.round(b.y + b.height - PET_BUBBLE_HEIGHT);
    if (ny < workArea.y) ny = workArea.y;
    bubbleActive = true;
    petWin.setBounds({ x: nx, y: ny, width: PET_BUBBLE_WIDTH, height: PET_BUBBLE_HEIGHT });
  } else {
    const nx = Math.round(b.x + (b.width - PET_SIZE) / 2);
    const ny = Math.round(b.y + b.height - PET_SIZE);
    bubbleActive = false;
    petWin.setBounds({ x: nx, y: ny, width: PET_SIZE, height: PET_SIZE });
    const [fx, fy] = petWin.getPosition();
    writeState({ x: fx, y: fy });
  }
}

function createPetWindow(preloadPath: string, theme: string): BrowserWindow {
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
    webPreferences: { preload: preloadPath },
  });
}

/** 开关桌宠。loadPetPage：给窗口加载 pet.html（主进程注入 dev/prod 路径差异）。 */
export function togglePetWindow(
  loadPetPage: (win: BrowserWindow) => void,
  preloadPath: string,
  theme: string,
): boolean {
  if (petWin && !petWin.isDestroyed()) {
    petWin.close();
    petWin = null;
    petEnabled = false;
    writeState({ enabled: false, theme });
    return false;
  }
  petWin = createPetWindow(preloadPath, theme);
  console.log('[pet] 桌宠窗口已创建 (theme=' + theme + ')');
  loadPetPage(petWin);
  petWin.webContents.on('did-finish-load', () => {
    console.log('[pet] did-finish-load');
    void petWin?.webContents.executeJavaScript('window.setPetTheme(' + JSON.stringify(theme) + ')').catch(() => {});
  });
  petWin.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[pet] did-fail-load', code, desc, url));
  petWin.webContents.on('render-process-gone', (_e, details) => console.error('[pet] render-process-gone', details.reason));
  petWin.on('moved', () => {
    // 气泡态的位移是扩窗/拖拽的临时值，收缩时会统一定稿，不落盘
    if (bubbleActive) return;
    const [x, y] = petWin?.getPosition() ?? [0, 0];
    writeState({ x, y });
  });
  petWin.on('closed', () => {
    petWin = null;
    bubbleActive = false;
  });
  petEnabled = true;
  writeState({ enabled: true, theme });
  return true;
}

/** 托盘/设置页开关：按持久化的主题开关桌宠。 */
export function togglePetEnabled(loadPetPage: (win: BrowserWindow) => void, preloadPath: string): boolean {
  return togglePetWindow(loadPetPage, preloadPath, readState().theme);
}

export function isPetWindowAlive(): boolean {
  return petWin !== null && !petWin.isDestroyed();
}

export function readPetTheme(): string {
  return readState().theme;
}

export function isPetEnabledInState(): boolean {
  return readState().enabled === true;
}

export function registerPetIpc(
  focusMain: () => void,
  loadPetPage: (win: BrowserWindow) => void,
  preloadPath: string,
): void {
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
  ipcMain.handle('pet:toggle', () => togglePetEnabled(loadPetPage, preloadPath));
  ipcMain.handle('pet:get-state', () => ({
    enabled: isPetWindowAlive(),
    theme: readState().theme,
  }));
  ipcMain.handle('pet:set-theme', (_e, theme: string) => {
    if (typeof theme !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(theme)) return;
    writeState({ theme });
    if (petWin && !petWin.isDestroyed()) {
      void petWin.webContents.executeJavaScript('window.setPetTheme(' + JSON.stringify(theme) + ')').catch(() => {});
    }
  });
  ipcMain.handle('pet:set-bubble', (_e, active: boolean) => {
    setPetBubble(active === true);
  });
}
