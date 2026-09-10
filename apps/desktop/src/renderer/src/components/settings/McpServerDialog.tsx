/**
 * McpServerDialog — 自定义 MCP server 的新增/编辑对话框（Radix Dialog）。
 * 类型分段：本地（stdio：command + args）/ 远程（streamable-http：url）。
 * token 仅写入不回显（safeStorage）；自定义 headers 每行一条 `Name: Value`。
 */
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { McpServerInput, McpServerView } from '../../../../shared/fundet-api.ts';

interface McpServerDialogProps {
  initial: McpServerView | null;
  onClose: () => void;
  onSaved: () => void;
}

/** headers 文本（每行 `Name: Value`）→ 对象；空行与无冒号行忽略 */
function parseHeadersText(text: string): Record<string, string> | { error: string } {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) return { error: `headers 行格式应为「Name: Value」：「${trimmed}」` };
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

export function McpServerDialog({
  initial,
  onClose,
  onSaved,
}: McpServerDialogProps): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<'stdio' | 'http'>(initial?.type ?? 'http');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [argsText, setArgsText] = useState((initial?.args ?? []).join(' '));
  const [url, setUrl] = useState(initial?.url ?? '');
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [headersText, setHeadersText] = useState(
    Object.entries(initial?.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = (): void => {
    const trimmedName = name.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      setError('名称只能含字母 / 数字 / _ / -');
      return;
    }
    let headers: Record<string, string>;
    const parsed = parseHeadersText(headersText);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    headers = parsed;

    const input: McpServerInput = {
      name: trimmedName,
      type,
      headers: type === 'http' ? headers : {},
    };
    if (type === 'stdio') {
      if (!command.trim()) {
        setError('本地类型必须填写启动命令');
        return;
      }
      input.command = command.trim();
      const args: string[] = argsText
        .split(' ')
        .map((s: string) => s.trim())
        .filter(Boolean);
      input.args = args;
    } else {
      if (!url.trim()) {
        setError('远程类型必须填写端点 URL');
        return;
      }
      input.url = url.trim();
    }
    // token：新增时非空即设；编辑时留空=不变、勾选清除=删、输入=覆盖
    if (!initial && token.trim()) input.token = token.trim();
    if (initial) {
      if (clearToken) input.token = '';
      else if (token.trim()) input.token = token.trim();
    }

    setSaving(true);
    void (initial
      ? window.fundet.updateMcpServer(initial.id, input)
      : window.fundet.createMcpServer(input)
    )
      .then(onSaved)
      .catch((err) => {
        setSaving(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const inputCls =
    'w-full rounded-lg border border-board bg-card px-3 py-2 text-13 text-primary outline-none placeholder:text-muted focus:border-[var(--accent,#2563eb)]';

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--overlay-modal)]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(640px,calc(100vh-48px))] w-[min(520px,100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-board bg-card">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-board px-4">
            <Dialog.Title className="text-14 font-semibold text-primary">
              {initial ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="text-muted hover:text-primary" aria-label="关闭">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            <label className="flex flex-col gap-1">
              <span className="text-12 text-secondary">名称（字母 / 数字 / _ / -）</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-tools"
                className={inputCls}
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-12 text-secondary">类型</span>
              <div className="flex gap-1 rounded-lg border border-board p-0.5">
                {(
                  [
                    { id: 'http', label: '远程端点' },
                    { id: 'stdio', label: '本地进程' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={
                      'flex-1 rounded-md px-3 py-1.5 text-12 transition-colors ' +
                      (type === t.id
                        ? 'bg-[var(--accent,#2563eb)]/10 text-primary'
                        : 'text-secondary hover:text-primary')
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {type === 'stdio' ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-secondary">启动命令</span>
                  <input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npx"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-secondary">参数（空格分隔）</span>
                  <input
                    value={argsText}
                    onChange={(e) => setArgsText(e.target.value)}
                    placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    className={inputCls}
                  />
                </label>
              </>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-12 text-secondary">端点 URL（https，或本机 http）</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  className={inputCls}
                />
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-12 text-secondary">
                Bearer Token（可选，加密存储{initial?.hasToken ? '；已保存，留空保持不变' : ''}）
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={clearToken ? '' : token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setClearToken(false);
                  }}
                  placeholder={initial?.hasToken ? '••••••••' : '留空表示不使用'}
                  className={inputCls}
                />
                {initial?.hasToken && (
                  <button
                    type="button"
                    onClick={() => setClearToken(true)}
                    className={
                      'shrink-0 text-12 transition-colors ' +
                      (clearToken ? 'text-error' : 'text-muted hover:text-primary')
                    }
                  >
                    {clearToken ? '将清除' : '清除'}
                  </button>
                )}
              </div>
            </label>

            {type === 'http' && (
              <label className="flex flex-col gap-1">
                <span className="text-12 text-secondary">自定义 Headers（每行一条 Name: Value）</span>
                <textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  rows={3}
                  placeholder={'X-Api-Key: your-key'}
                  className={inputCls + ' resize-y font-mono'}
                />
              </label>
            )}

            {error && <p className="text-12 text-error">{error}</p>}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-board px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-board px-3 py-1.5 text-13 text-secondary transition-colors hover:text-primary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-[var(--accent,#2563eb)] px-4 py-1.5 text-13 text-white transition-opacity disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
