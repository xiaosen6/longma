/** 浏览器自动化域 IPC：开关、内网放行、登录入口、系统浏览器登录态拷贝。 */
import { ipcMain } from 'electron';
import { createConsoleLogger } from '@fundet/agent-core';
import { ensureBrowserRuntime, stopManagedRuntime, resetBrowserHostForConfigChange } from '../../browser/host.js';
import {
  clearCopiedLogins,
  listInstalledChromium,
  managedUserDataMember,
  realLoginsApplied,
  snapshotRealProfile,
  RealProfileError,
} from '../../browser/real-profile.ts';
import { setSetting, getSetting, getBoolSetting, setBoolSetting } from '../../db/settings.js';
import { BROWSER_ENABLED_SETTING, BROWSER_ALLOW_PRIVATE_SETTING } from '../../../shared/browser-settings.ts';
import { FUNDET_INVOKE } from '../channels.js';

export function registerBrowserHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.BROWSER_STATUS, async () => ({
    enabled: getBoolSetting(BROWSER_ENABLED_SETTING, false),
    allowPrivateNetwork: getBoolSetting(BROWSER_ALLOW_PRIVATE_SETTING, false),
  }));

  ipcMain.handle(FUNDET_INVOKE.BROWSER_SET_ENABLED, async (_e, enabled: boolean) => {
    setBoolSetting(BROWSER_ENABLED_SETTING, Boolean(enabled));
  });

  // 内网导航放行：写设置 + 丢弃已建 runtime 单例（policy 只在装配时读取），
  // 下次 action 按新 policy 重建；未用过的 runtime 直接丢弃零成本
  ipcMain.handle(FUNDET_INVOKE.BROWSER_SET_ALLOW_PRIVATE, async (_e, enabled: boolean) => {
    setBoolSetting(BROWSER_ALLOW_PRIVATE_SETTING, Boolean(enabled));
    await resetBrowserHostForConfigChange();
  });

  // 登录入口：start + focus（已开则聚焦），绝不新开 tab——冷启动时 open 会开出双 tab
  ipcMain.handle(FUNDET_INVOKE.BROWSER_OPEN, async () => {
    const logger = createConsoleLogger('fundet');
    const runtime = await ensureBrowserRuntime(logger);
    if (!runtime) throw new Error('浏览器运行时不可用：本机未检测到 Chromium 系浏览器');
    await runtime.call({ action: 'start' });
    await runtime.call({ action: 'focus' });
  });

  // ---------- 系统浏览器登录态 ----------
  const REAL_LOGINS_SOURCE_KEY = 'browser.realLogins.source';

  ipcMain.handle(FUNDET_INVOKE.BROWSER_REAL_LOGINS, async () => {
    const dir = managedUserDataMember().userDataDir;
    return { enabled: realLoginsApplied(dir), source: getSetting(REAL_LOGINS_SOURCE_KEY) };
  });

  ipcMain.handle(FUNDET_INVOKE.BROWSER_SET_REAL_LOGINS, async (_e, enabled: boolean) => {
    // 先停托管浏览器（锁自己的 user-data）；失败由快照阶段报 PROFILE_LOCKED
    await stopManagedRuntime();
    const dir = managedUserDataMember().userDataDir;
    if (enabled) {
      const installed = listInstalledChromium();
      if (installed.length === 0) {
        throw new Error('未检测到系统 Chrome / Edge / Brave，无法拷贝登录状态。');
      }
      try {
        const result = snapshotRealProfile({ source: installed[0], destDir: dir });
        setSetting(REAL_LOGINS_SOURCE_KEY, result.sourceKind);
      } catch (err) {
        if (err instanceof RealProfileError) throw new Error(err.message);
        throw err;
      }
    } else {
      clearCopiedLogins(dir);
      setSetting(REAL_LOGINS_SOURCE_KEY, null);
    }
  });
}
