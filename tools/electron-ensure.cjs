#!/usr/bin/env node
/**
 * Electron 二进制保障脚本（desktop postinstall 调用）。
 *
 * 背景：electron@44 移除了包自身的 postinstall，pnpm install 后
 * node_modules/electron/dist 不再自动下载——dev 报 "Error: Electron uninstall"、
 * electron-builder 打包报 "electronDist does not exist"（v0.2.19 发版踩坑）。
 *
 * 行为：
 *  - ELECTRON_SKIP_BINARY_DOWNLOAD=1（ci.yml 纯测试环境）：直接跳过；
 *  - dist 已存在（install.js 自身幂等检查）：秒退；
 *  - 否则跑 electron/install.js 下载；ELECTRON_MIRROR 环境变量透传（国内镜像）。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1') {
  console.log('[electron-ensure] ELECTRON_SKIP_BINARY_DOWNLOAD=1，跳过二进制下载');
  process.exit(0);
}

// workspace 布局：本脚本在 tools/，desktop 的 node_modules 在 apps/desktop/
const candidates = [
  path.join(__dirname, '..', 'apps', 'desktop', 'node_modules', 'electron'),
  path.join(__dirname, '..', 'node_modules', 'electron'),
];
const electronDir = candidates.find((dir) => fs.existsSync(path.join(dir, 'install.js')));
if (!electronDir) {
  console.log('[electron-ensure] 未找到 electron 包（可能 ELECTRON_SKIP 场景），跳过');
  process.exit(0);
}

const dist = path.join(electronDir, 'dist');
if (fs.existsSync(dist)) {
  console.log('[electron-ensure] electron dist 已就绪');
  process.exit(0);
}

console.log('[electron-ensure] 下载 Electron 二进制（ELECTRON_MIRROR 可加速）…');
const result = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
  stdio: 'inherit',
  env: process.env,
});
if (result.status !== 0) {
  // 不阻断 install（离线环境装依赖仍应成功）；打包/启动时会得到明确报错
  console.warn('[electron-ensure] 二进制下载失败（不阻断 install）——可手动：');
  console.warn(`  $env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; node ${path.join(electronDir, 'install.js')}`);
  process.exit(0);
}
console.log('[electron-ensure] Electron 二进制就绪');
