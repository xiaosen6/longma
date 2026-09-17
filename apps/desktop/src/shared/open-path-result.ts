/**
 * openPath 的结果边界（移植 Cindy #4404）：preload 侧把 IPC 传输层失败收进
 * 结果对象而非 rejection——渲染帧销毁/退出期的 'reply was never sent'、
 * 'Render frame was disposed' 属于生命周期噪音（用户无从行动），标
 * failureKind='ipc_lifecycle' 由调用方静默；真正的打开失败照常带 error。
 */

export interface OpenPathResult {
  success: boolean;
  error?: string;
  /** IPC 生命周期失败（窗口正在关/帧已销毁）——调用方应静默 */
  failureKind?: 'ipc_lifecycle';
}

/** 仅识别「IPC 传输层死了」的两类 rejection 文案；main 侧真实错误原样透传。 */
export function classifyIpcLifecycle(error: string): 'ipc_lifecycle' | undefined {
  return /^(?:reply was never sent[.!]?|Render frame was disposed(?: before WebFrameMain could be accessed)?[.!]?)$/.test(
    error,
  )
    ? 'ipc_lifecycle'
    : undefined;
}
