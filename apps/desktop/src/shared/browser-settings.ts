/** 浏览器自动化共享常量（主进程 + 渲染层） */
export const BROWSER_MCP_SERVER_NAME = 'browser';
/** 设置表里的开关 key */
export const BROWSER_ENABLED_SETTING = 'browser.enabled';
/** 放行内网/本机地址导航（默认关；对企业内网、本地开发调试场景） */
export const BROWSER_ALLOW_PRIVATE_SETTING = 'browser.allowPrivateNetwork';

export interface BrowserStatus {
  enabled: boolean;
  /** 是否放行内网/本机导航 */
  allowPrivateNetwork: boolean;
  /** 本机是否检测到 Chromium 系浏览器（设置页展示用；探测不启动任何进程） */
  chromeAvailable: boolean;
}
