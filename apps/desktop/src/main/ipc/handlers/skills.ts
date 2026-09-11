/** 技能域 IPC：列表、导入、卸载、启停 + pi 运行时版本（关于页）。 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { getPiVersion } from '../../host/pi-binary.js';
import { importSkillFile, listSkills, uninstallSkill, setSkillEnabled } from '../../host/skills.js';
import { FUNDET_INVOKE } from '../channels.js';

export function registerSkillHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.SKILLS_LIST, async (_e, workDir?: string) => listSkills(workDir));

  // ---------- pi 运行时版本（关于页显示） ----------
  ipcMain.handle(FUNDET_INVOKE.PI_GET_VERSION, () => getPiVersion());

  ipcMain.handle(FUNDET_INVOKE.SKILLS_PICK, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: '导入技能',
      properties: ['openFile' as const],
      filters: [{ name: 'Skill', extensions: ['md', 'zip'] }],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (picked.canceled || !picked.filePaths[0]) return null;
    return picked.filePaths[0];
  });

  ipcMain.handle(
    FUNDET_INVOKE.SKILLS_IMPORT,
    async (_e, filePath: string, scope: 'user' | 'project', workDir?: string) =>
      importSkillFile(filePath, scope, workDir),
  );

  ipcMain.handle(FUNDET_INVOKE.SKILLS_UNINSTALL, async (_e, skillDir: string) => {
    uninstallSkill(skillDir);
  });

  ipcMain.handle(FUNDET_INVOKE.SKILLS_SET_ENABLED, async (_e, name: string, enabled: boolean) => {
    setSkillEnabled(String(name), enabled === true);
  });
}
