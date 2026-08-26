/**
 * 供应商错误的用户话术映射。原始报错（pi 透传的 HTTP 错误文本）偏技术，
 * 常见两类有明确的用户行动项：模型不支持图片 / max_tokens 超上限。
 */

export function friendlyProviderError(raw: string): string {
  // 智谱 1210：messages.content.type 参数非法，取值范围 ['text']（模型非视觉）
  if (/content\.type/i.test(raw) && /\['text'\]|\"text\"/i.test(raw)) {
    return (
      '该模型不支持图片输入。请在 设置 → 模型供应商 里换用视觉模型' +
      '（如 glm-4v 系列、doubao vision 系列），或用模型行上的「视觉」开关修正后重试。'
    );
  }
  if (/max_tokens/i.test(raw) && /非法|限制|范围|invalid|range|maximum/i.test(raw)) {
    return (
      '该模型的最大输出（max_tokens）超出上限。请在 设置 → 模型供应商 编辑该模型，' +
      '调小 maxTokens 后重试。'
    );
  }
  return raw;
}
