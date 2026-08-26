import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // workspace 包是裸 TS 源码（@fundet/agent-core 的 exports 指向 src/*.ts），
    // 必须让 vite 打包进产物，不能 externalize；better-sqlite3 等原生模块保持 external。
    plugins: [externalizeDepsPlugin({ exclude: ['@fundet/agent-core', '@fundet/shared'] })],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // sandbox:true 下渲染进程只能加载 CJS preload（ESM preload 沙箱不支持，
        // window.fundet 会注入失败）。package.json 是 type:module，须显式压回 CJS。
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
