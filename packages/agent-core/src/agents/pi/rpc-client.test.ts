import { EventEmitter } from 'node:events';
import type { Readable as NodeReadableStream } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { attachJsonlReader, MAX_JSONL_BUFFER_CHARS, PiRpcProcess, PI_RPC_OVERSIZED_FRAME_ERROR } from './rpc-client.js';

function makeStream() {
  return new EventEmitter();
}

function makeChild(pid = 4321) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.stdout = makeStream();
  child.stderr = makeStream();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
}

function createProcess(onProcessSpawned?: (pid: number) => void | (() => void)) {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return new PiRpcProcess({
    binaryPath: '/pi',
    args: ['--mode', 'rpc'],
    cwd: '/work',
    env: {},
    logger,
    onEvent: vi.fn(),
    onExit: vi.fn(),
    onProcessSpawned,
  });
}

beforeEach(() => {
  mocks.spawn.mockReset();
});

describe('PiRpcProcess process observer', () => {
  it('registers the concrete PID and disposes that generation once on close', () => {
    const child = makeChild();
    mocks.spawn.mockReturnValue(child);
    const dispose = vi.fn();
    const onProcessSpawned = vi.fn(() => dispose);

    createProcess(onProcessSpawned);
    expect(onProcessSpawned).toHaveBeenCalledWith(4321);

    child.emit('close', 0, null);
    child.emit('close', 0, null);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('observer failure does not block process startup', () => {
    mocks.spawn.mockReturnValue(makeChild());
    expect(() =>
      createProcess(() => {
        throw new Error('observer failed');
      }),
    ).not.toThrow();
  });
});

describe('PiRpcProcess oversized JSONL frames（对齐 Cindy #4518）', () => {
  it('超限帧让 pending get_entries 立即失败,不误伤其它命令,不空等超时', async () => {
    const child = makeChild();
    mocks.spawn.mockReturnValue(child);
    const proc = createProcess();

    const getEntries = proc.request({ type: 'get_entries', path: 'x' });
    const steer = proc.request({ type: 'steer', text: 'y' });
    await Promise.resolve();

    // 无换行的超限块 → 进入跳帧模式并通知协议层
    child.stdout.emit('data', Buffer.from('a'.repeat(MAX_JSONL_BUFFER_CHARS + 10)));
    const resp = await getEntries;
    expect(resp.success).toBe(false);
    expect(resp.error).toBe(PI_RPC_OVERSIZED_FRAME_ERROR);
    expect(resp.command).toBe('get_entries');

    // steer 不在被猜中的受害范围内：仍 pending（未 settle）
    const settled = await Promise.race([steer.then(() => true), Promise.resolve(false)]);
    expect(settled).toBe(false);

    // 跳帧恢复后,残余被丢弃、后续合法帧正常解析（帧对齐保持）
    const stream = new EventEmitter() as unknown as NodeReadableStream;
    const lines: string[] = [];
    attachJsonlReader(stream, (l) => lines.push(l), () => {});
    stream.emit('data', Buffer.from('a'.repeat(MAX_JSONL_BUFFER_CHARS + 5) + '\n{"ok":1}\n'));
    expect(lines).toEqual(['{"ok":1}']);
  });

  it('跨 chunk 的超限行:残余继续丢,直到换行后恢复分帧', () => {
    const stream = new EventEmitter() as unknown as NodeReadableStream;
    const lines: string[] = [];
    let oversized = 0;
    attachJsonlReader(
      stream,
      (l) => lines.push(l),
      () => {
        oversized += 1;
      },
    );
    stream.emit('data', Buffer.from('b'.repeat(MAX_JSONL_BUFFER_CHARS + 1)));
    stream.emit('data', Buffer.from('残余无换行'));
    stream.emit('data', Buffer.from('继续丢\n'));
    stream.emit('data', Buffer.from('{"next":true}\n'));
    expect(lines).toEqual(['{"next":true}']);
    expect(oversized).toBeGreaterThanOrEqual(1);
  });
});
