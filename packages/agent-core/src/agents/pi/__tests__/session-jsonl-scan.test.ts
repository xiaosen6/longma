import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanPiSessionJsonl } from '../session-jsonl-scan.js';

let dirs: string[] = [];

async function tmpFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pi-jsonl-scan-'));
  dirs.push(dir);
  const file = path.join(dir, 'session.jsonl');
  await writeFile(file, content, 'utf8');
  return file;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe('scanPiSessionJsonl（移植 Cindy #4518）', () => {
  it('提取 user entry id 集合与最后一条 plan-mode', async () => {
    const file = await tmpFile([
      JSON.stringify({ type: 'message', id: 'u1', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'message', id: 'a1', message: { role: 'assistant', content: 'yo' } }),
      JSON.stringify({ type: 'message', id: 'u2', message: { role: 'user', content: 'again' } }),
      JSON.stringify({ type: 'custom', id: 'p1', customType: 'plan-mode', data: { enabled: true } }),
      JSON.stringify({ type: 'custom', id: 'p2', customType: 'plan-mode', data: { enabled: false } }),
      '',
    ].join('\n'));
    const scan = await scanPiSessionJsonl(file);
    expect(scan).not.toBeNull();
    expect([...scan!.userEntryIds].sort()).toEqual(['u1', 'u2']);
    expect(scan!.lastPlanModeEnabled).toBe(false);
  });

  it('超大行只解析前 4KiB 前缀,不丢后续行', async () => {
    const huge = JSON.stringify({ type: 'message', id: 'big', message: { role: 'user', content: 'x'.repeat(1024 * 1024) } });
    const next = JSON.stringify({ type: 'message', id: 'after', message: { role: 'user', content: 'ok' } });
    const file = await tmpFile(huge + '\n' + next + '\n');
    const scan = await scanPiSessionJsonl(file);
    expect(scan!.userEntryIds.has('big')).toBe(true);
    expect(scan!.userEntryIds.has('after')).toBe(true);
  });

  it('文件不存在返回 null（调用方回落 RPC）', async () => {
    const scan = await scanPiSessionJsonl(path.join(tmpdir(), 'definitely-missing-' + Date.now() + '.jsonl'));
    expect(scan).toBeNull();
  });

  it('CRLF 行尾被剥离', async () => {
    const file = await tmpFile(
      JSON.stringify({ type: 'message', id: 'crlf', message: { role: 'user', content: 'x' } }) + '\r\n',
    );
    const scan = await scanPiSessionJsonl(file);
    expect(scan!.userEntryIds.has('crlf')).toBe(true);
  });
});
