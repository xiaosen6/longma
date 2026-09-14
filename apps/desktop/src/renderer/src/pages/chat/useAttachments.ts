import { useCallback, useState } from 'react';
import type { SessionAttachment } from '../../../../shared/fundet-api.ts';

/**
 * 附件管理：合并去重、staging（路径引用 / bytes 落 .longma-uploads）、
 * 拖入 File 列表（有路径走 stageFiles，无路径走 stageBytes）。
 */
export function useAttachments(
  sessionWorkDir: string,
  setNotice: (msg: string) => void,
  onStaged: (lastPath: string) => void,
): {
  attachments: SessionAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<SessionAttachment[]>>;
  mergeAttachments: (incoming: SessionAttachment[]) => void;
  stagePaths: (paths: string[]) => Promise<void>;
  addDroppedFiles: (fileList: File[]) => Promise<void>;
  pickFiles: () => Promise<void>;
  pasteText: (text: string) => Promise<void>;
  reset: () => void;
} {
  const [attachments, setAttachments] = useState<SessionAttachment[]>([]);

  const mergeAttachments = useCallback((incoming: SessionAttachment[]): void => {
    setAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.path));
      const next = [...prev];
      for (const a of incoming) {
        if (seen.has(a.path)) continue;
        seen.add(a.path);
        next.push(a);
      }
      return next;
    });
    const last = incoming[incoming.length - 1];
    if (last) onStaged(last.path);
  }, [onStaged]);

  const stagePaths = useCallback(
    async (paths: string[]): Promise<void> => {
      const dir = sessionWorkDir.trim();
      if (!dir) {
        setNotice('请先选择工作目录');
        return;
      }
      try {
        const staged = await window.fundet.stageFiles(dir, paths);
        mergeAttachments(staged);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [mergeAttachments, sessionWorkDir, setNotice],
  );

  const addDroppedFiles = useCallback(
    async (fileList: File[]): Promise<void> => {
      const dir = sessionWorkDir.trim();
      if (!dir) {
        setNotice('请先选择工作目录');
        return;
      }
      const paths: string[] = [];
      const blobs: File[] = [];
      for (const f of fileList) {
        const p = window.fundet.getPathForFile(f);
        if (p) paths.push(p);
        else blobs.push(f);
      }
      if (paths.length > 0) await stagePaths(paths);
      for (const f of blobs) {
        try {
          const buf = await f.arrayBuffer();
          const staged = await window.fundet.stageBytes(dir, f.name || 'paste', buf);
          mergeAttachments([staged]);
        } catch (err) {
          setNotice(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [mergeAttachments, sessionWorkDir, setNotice, stagePaths],
  );

  const pickFiles = useCallback(async (): Promise<void> => {
    const picked = await window.fundet.pickFiles();
    if (picked && picked.length > 0) await stagePaths(picked);
  }, [stagePaths]);

  /** 粘贴多行/长文本 → 落盘为 txt 附件，显示名「粘贴的文本(N 行)」（对齐 Cindy） */
  const pasteText = useCallback(
    async (text: string): Promise<void> => {
      const dir = sessionWorkDir.trim();
      if (!dir) {
        setNotice('请先选择工作目录');
        return;
      }
      const lines = text.split(/\r?\n/).length;
      try {
        const staged = await window.fundet.stageBytes(
          dir,
          `pasted-${Date.now()}.txt`,
          new TextEncoder().encode(text).buffer as ArrayBuffer,
        );
        // 落盘名唯一化；chip 显示名按 Cindy 形态
        mergeAttachments([{ ...staged, name: `粘贴的文本(${lines} 行)` }]);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [mergeAttachments, sessionWorkDir, setNotice],
  );

  const reset = useCallback((): void => {
    setAttachments([]);
  }, []);

  return { attachments, setAttachments, mergeAttachments, stagePaths, addDroppedFiles, pickFiles, pasteText, reset };
}
