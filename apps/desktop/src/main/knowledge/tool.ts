/**
 * knowledge MCP 工具处理器：knowledge_search / knowledge_list 的实现。
 * 文案面向模型：无库/无结果时给明确指引（原样转告用户）。
 */
import { listKnowledgeBases, listKnowledgeItems, searchKnowledge } from './service.ts';

function ok(text: string): { text: string; isError: boolean } {
  return { text, isError: false };
}

export async function handleKnowledgeTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const bases = listKnowledgeBases();
  if (name === 'knowledge_list') {
    if (bases.length === 0) return ok('还没有知识库。请用户到 设置 → 知识库 新建并导入文档。');
    const lines: string[] = [];
    for (const b of bases) {
      const items = listKnowledgeItems(b.id);
      lines.push(`- ${b.name}（id=${b.id}，${b.fileCount} 个文件 / ${b.chunkCount} 块）`);
      for (const it of items) {
        lines.push(`  · ${it.name}（${it.status}，${it.chunkCount} 块）`);
      }
    }
    return ok(`知识库清单：\n${lines.join('\n')}`);
  }
  // knowledge_search
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { text: 'query 不能为空', isError: true };
  if (bases.length === 0) {
    return ok('还没有知识库可检索。请用户到 设置 → 知识库 新建并导入文档后再试。');
  }
  const baseId = typeof args.baseId === 'string' && args.baseId.trim() ? args.baseId.trim() : undefined;
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 6;
  const results = searchKnowledge(query, baseId, limit);
  if (results.length === 0) {
    return ok(`知识库中没有检索到与「${query}」相关的内容。可以换更具体的关键词再试，或告知用户资料可能不在知识库里。`);
  }
  const parts = results.map((r, i) =>
    `[${i + 1}] 来源：${r.baseName} / ${r.itemName}（第 ${r.seq + 1} 块）\n${r.text}`,
  );
  return ok(`共 ${results.length} 条检索结果：\n\n${parts.join('\n\n---\n\n')}`);
}
