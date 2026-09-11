import { useCallback, useEffect, useMemo, useState } from 'react';
import { collectArtifacts, type Artifact } from '../../lib/artifacts';
import { fileKind } from '../../../../shared/file-kind.ts';
import type { DisplayItem } from '../../stores/sessionStore';
import type { SessionAttachment } from '../../../../shared/fundet-api.ts';

/**
 * Canvas 面板状态 + 产物收集。
 * 只跟踪最新产物路径（顶栏按钮用），不强制打开——产物每回合都在变，
 * 强制开会让用户「关不掉」（对齐 Cindy：数据变化不打扰用户）。
 */
export function useCanvasTracker(items: DisplayItem[], attachments: SessionAttachment[]): {
  canvasOpen: boolean;
  canvasPath: string | null;
  setCanvasOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setCanvasPath: (p: string | ((prev: string | null) => string | null)) => void;
  openCanvas: (p: string) => void;
  reset: () => void;
  artifacts: Artifact[];
} {
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasPath, setCanvasPath] = useState<string | null>(null);

  const artifacts = useMemo(() => {
    const fromItems = collectArtifacts(items);
    const seen = new Set(fromItems.map((a) => a.path));
    const extra: Artifact[] = [];
    for (const a of attachments) {
      if (seen.has(a.path)) continue;
      extra.push({ path: a.path, kind: fileKind(a.path), toolName: 'attach' });
    }
    return extra.length > 0 ? [...fromItems, ...extra] : fromItems;
  }, [items, attachments]);

  const latestArtifact = artifacts[artifacts.length - 1]?.path;
  useEffect(() => {
    if (latestArtifact && canvasPath === null) setCanvasPath(latestArtifact);
  }, [latestArtifact, canvasPath]);

  const openCanvas = useCallback((p: string) => {
    setCanvasPath(p);
    setCanvasOpen(true);
  }, []);

  const reset = useCallback((): void => {
    setCanvasOpen(false);
    setCanvasPath(null);
  }, []);

  return { canvasOpen, canvasPath, setCanvasOpen, setCanvasPath, openCanvas, reset, artifacts };
}
