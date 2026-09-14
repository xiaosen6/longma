/**
 * 流式 markdown 块切分（对齐 Cindy ceb279db0 的块级复用思路）：
 * 流式文本按 markdown 块边界（空行）切分，代码围栏内的空行不切。
 * 除最后一块外都标记 stable——内容不再变化，渲染层 memo 后零重解析；
 * 每 tick 只重解析尾部未完成块。终版（streaming=false）仍走全文单渲染，
 * 保证终态视觉与跨块上下文（Setext/引用延续等边缘语法）零差异。
 */
export interface StreamingBlock {
  /** 块序号：流式中文本只会尾部追加，序号天然稳定 */
  key: string;
  text: string;
  /** 非最后一块：内容已封口不再变化 */
  stable: boolean;
}

export function splitStreamingBlocks(text: string): StreamingBlock[] {
  if (!text) return [];
  const lines = text.split('\n');
  const rawBlocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (inFence) {
      current.push(line);
      if (fenceMatch && trimmed.slice(fenceMatch[1].length).startsWith(fenceMarker)) {
        inFence = false;
      }
      continue;
    }
    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[2];
      current.push(line);
      continue;
    }
    if (trimmed === '') {
      // 空行=块边界（围栏外）。连续空行只切一次。
      if (current.length > 0) {
        rawBlocks.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  // 尾部未封口内容（无结尾空行）：作为最后一块持续生长
  if (current.length > 0) rawBlocks.push(current.join('\n'));

  return rawBlocks.map((blockText, i) => ({
    key: `b${i}`,
    text: blockText,
    stable: i < rawBlocks.length - 1,
  }));
}
