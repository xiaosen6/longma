import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/**
 * 只扫 session JSONL 的元数据：user entry id 与最后一条 plan-mode（移植 Cindy #4518）。
 * 不经过 Pi RPC，也不把整段带图历史装进 16Mi 字符的 JSONL 响应帧——大行只解析
 * 前 4KiB 前缀（正则提字段），流式逐行、跨 chunk 维护缓冲。
 */

const ENTRY_PREFIX_CHARS = 4096;

export interface PiSessionJsonlScan {
  userEntryIds: Set<string>;
  lastPlanModeEnabled: boolean | null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function firstQuoted(field: string, prefix: string): string | undefined {
  const match = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`).exec(prefix);
  return match?.[1];
}

function extractEntryMeta(line: string): {
  type?: string;
  id?: string;
  role?: string;
  customType?: string;
  planEnabled?: boolean;
} {
  const prefix = line.length > ENTRY_PREFIX_CHARS ? line.slice(0, ENTRY_PREFIX_CHARS) : line;
  if (line.length <= 64 * 1024) {
    try {
      const entry = recordOf(JSON.parse(line));
      if (!entry) return {};
      const message = recordOf(entry.message);
      const data = recordOf(entry.data);
      return {
        type: typeof entry.type === 'string' ? entry.type : undefined,
        id: typeof entry.id === 'string' ? entry.id : undefined,
        role: typeof message?.role === 'string' ? message.role : undefined,
        customType: typeof entry.customType === 'string' ? entry.customType : undefined,
        planEnabled: typeof data?.enabled === 'boolean' ? data.enabled : undefined,
      };
    } catch {
      /* 截断/超大的行落回前缀正则扫描 */
    }
  }
  return {
    type: firstQuoted('type', prefix),
    id: firstQuoted('id', prefix),
    role: firstQuoted('role', prefix),
    customType: firstQuoted('customType', prefix),
  };
}

function applyEntry(scan: PiSessionJsonlScan, line: string): void {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (trimmed.length === 0) return;
  const meta = extractEntryMeta(trimmed);
  if (meta.type === 'message' && meta.role === 'user' && meta.id) {
    scan.userEntryIds.add(meta.id);
  }
  if (meta.customType === 'plan-mode' && typeof meta.planEnabled === 'boolean') {
    scan.lastPlanModeEnabled = meta.planEnabled;
  }
}

/** 扫描失败（文件缺失/读取错误）返回 null，调用方回落 get_entries RPC。 */
export async function scanPiSessionJsonl(sessionFile: string): Promise<PiSessionJsonlScan | null> {
  return new Promise((resolve) => {
    const scan: PiSessionJsonlScan = {
      userEntryIds: new Set<string>(),
      lastPlanModeEnabled: null,
    };
    const stream = createReadStream(sessionFile);
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let prefix = '';
    let skippingRestOfLine = false;
    let settled = false;

    const finish = (result: PiSessionJsonlScan | null): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const consumePrefixLine = (): void => {
      if (prefix.length === 0) return;
      applyEntry(scan, prefix);
      prefix = '';
    };

    const emitCompleteLines = (): void => {
      while (true) {
        if (skippingRestOfLine) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) {
            buffer = '';
            return;
          }
          buffer = buffer.slice(newlineIndex + 1);
          skippingRestOfLine = false;
          consumePrefixLine();
          continue;
        }
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          if (buffer.length > ENTRY_PREFIX_CHARS) {
            prefix = buffer.slice(0, ENTRY_PREFIX_CHARS);
            buffer = '';
            skippingRestOfLine = true;
          }
          return;
        }
        applyEntry(scan, buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
      }
    };

    stream.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      emitCompleteLines();
    });
    stream.on('error', () => finish(null));
    stream.on('end', () => {
      buffer += decoder.end();
      emitCompleteLines();
      if (!skippingRestOfLine && buffer.length > 0) applyEntry(scan, buffer);
      else consumePrefixLine();
      finish(scan);
    });
  });
}
