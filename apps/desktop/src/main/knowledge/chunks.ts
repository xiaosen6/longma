/**
 * 知识库分块器（纯函数，可单测）。
 * 策略：按段落聚合到目标块大小，超长段落按句二次切分，块间保留重叠尾部。
 * 大小用字符数粗估（中文 1 字符 ≈ 1 token 的量级，无需 tokenizer）。
 */

export const CHUNK_TARGET_CHARS = 800;
export const CHUNK_MAX_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 80;

/** 按句边界把长文本切成 ≤max 的片段（单句超长则硬切） */
function splitLongParagraph(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[。！？；\n])/);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      // 单句超长：硬切
      if (cur) {
        out.push(cur);
        cur = '';
      }
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
      continue;
    }
    if ((cur + s).length > max) {
      if (cur) out.push(cur);
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 文本 → 知识块序列（带重叠尾部，保持检索上下文连续） */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const blocks: string[] = [];
  let cur = '';
  for (const p of paragraphs) {
    for (const piece of splitLongParagraph(p, CHUNK_MAX_CHARS)) {
      const trimmedPiece = piece.trim();
      if (!trimmedPiece) continue;
      if (!cur) {
        cur = trimmedPiece;
      } else if ((cur + '\n' + trimmedPiece).length <= CHUNK_TARGET_CHARS) {
        cur += '\n' + trimmedPiece;
      } else {
        blocks.push(cur);
        // 重叠尾部：上一块结尾接进新块开头
        cur = cur.slice(-CHUNK_OVERLAP_CHARS) + '\n' + trimmedPiece;
      }
    }
  }
  if (cur) blocks.push(cur);
  return blocks.filter((b) => b.trim().length > 0);
}
