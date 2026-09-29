import path from 'node:path';
import fs from 'node:fs';
import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import {
  FILE_PROTOCOL_SCHEME,
  parseFilePreviewUrl,
} from '../shared/file-preview-url.ts';
import { withHtmlPreviewCsp } from '../shared/html-preview-csp.ts';
import { resolveUnderWorkDir } from './fs-local.js';

/** 活跃 workDir 白名单：仅会话创建/恢复时注册的目录可通过协议读取 */
const registeredWorkDirs = new Set<string>();

/** 注册一个 workDir（会话创建/恢复时调用；幂等） */
export function registerWorkDir(workDir: string): void {
  const resolved = path.resolve(workDir).toLowerCase();
  registeredWorkDirs.add(resolved);
}

/** 注销一个 workDir（会话删除时调用） */
export function unregisterWorkDir(workDir: string): void {
  const resolved = path.resolve(workDir).toLowerCase();
  registeredWorkDirs.delete(resolved);
}

export function isWorkDirRegistered(workDir: string): boolean {
  const resolved = path.resolve(workDir).toLowerCase();
  return registeredWorkDirs.has(resolved);
}

export function registerFileProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerFileProtocolHandler(): void {
  protocol.handle(FILE_PROTOCOL_SCHEME, async (request) => {
    const parsed = parseFilePreviewUrl(request.url);
    if (!parsed) return new Response('Bad request', { status: 400 });
    // 安全：workDir 来自 URL 的 base64 段——可伪造。只放行主进程注册过的
    // 活跃会话 workDir，阻断「构造 longma-file://work/<base64(任意路径)>/
    // 读任意文件」的通道（协议带 supportFetchAPI，响应可被 fetch 回 renderer）。
    if (!isWorkDirRegistered(parsed.workDir)) {
      return new Response('Forbidden: workDir not registered', { status: 403 });
    }
    try {
      const resolved = resolveUnderWorkDir(parsed.relPath || '.', parsed.workDir);
      if (!(await fs.promises.stat(resolved)).isFile()) {
        return new Response('Not a file', { status: 404 });
      }
      // CanvasPane 预览 iframe 带 ?preview-csp=1：HTML 注入 CSP+能力剥离（agent
      // 产出不可信，出网必须引擎强制关闭）。用户自己的文件直开不带参数，行为不变。
      const wantsCsp =
        new URL(request.url).searchParams.get('preview-csp') === '1' &&
        /\.html?$/i.test(resolved);
      if (wantsCsp) {
        const html = await fs.promises.readFile(resolved, 'utf8');
        return new Response(withHtmlPreviewCsp(html), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      const range = request.headers.get('Range');
      const headers: Record<string, string> = {};
      if (range) headers.Range = range;
      return await net.fetch(pathToFileURL(resolved).href, {
        bypassCustomProtocolHandlers: true,
        headers,
      });
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  });
}
