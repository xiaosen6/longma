/** 电脑操作域 IPC：开关（开启时顺手关 driver 遥测）。 */
import { ipcMain } from 'electron';
import { getBoolSetting, setBoolSetting } from '../../db/settings.js';
import { COMPUTER_ENABLED_SETTING } from '../../../shared/computer-settings.ts';
import { disableCuaDriverTelemetry, resolveCuaDriverCommand } from '../../computer/driver.ts';
import { FUNDET_INVOKE } from '../channels.js';

export function registerComputerHandlers(): void {
  ipcMain.handle(FUNDET_INVOKE.COMPUTER_STATUS, async () => ({
    enabled: getBoolSetting(COMPUTER_ENABLED_SETTING, false),
    driverAvailable: Boolean(resolveCuaDriverCommand()),
  }));

  ipcMain.handle(FUNDET_INVOKE.COMPUTER_SET_ENABLED, async (_e, enabled: boolean) => {
    setBoolSetting(COMPUTER_ENABLED_SETTING, Boolean(enabled));
    // 开启时顺手关掉 driver 的无内容遥测（本地优先产品；异步执行，不在这个
    // IPC 里等它——telemetry 子命令可能与 mcp 子进程争全局锁，绝不能放会话装配路径）
    if (enabled) {
      const command = resolveCuaDriverCommand();
      if (command) disableCuaDriverTelemetry(command);
    }
  });
}
