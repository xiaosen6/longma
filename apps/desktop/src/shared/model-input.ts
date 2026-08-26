/**
 * 模型多模态（图像输入）能力推断 + 显式覆盖。
 *
 * 发送带图片的消息时 PiAgent 要求模型 input 含 'image'，否则直接拒发
 * （PiImageInputUnsupportedError）。providers 库里用户手填的模型默认没有
 * input 字段——按 id 推断已知视觉模型家族；推断不出来时用户可在
 * 设置 → 模型供应商里按模型开「视觉」显式指定（写库覆盖推断）。
 */

/** 已知支持图像输入的模型 id 家族（大小写不敏感）。未命中 = 不推断（文本模型）。 */
const VISION_ID_PATTERNS: RegExp[] = [
  // 通用命名约定
  /vision/i,
  /(^|[^a-z])vl(\d|$|[-_.])/i, // qwen-vl / deepseek-vl2 …
  /-vl-/i,
  /pixtral/i,
  // OpenAI：4o 起全系多模态（gpt-4o / gpt-4.1 / gpt-5 / o3 / o4-mini / chatgpt-4o）
  /^(chatgpt-)?gpt-(4o|4\.1|4\.5|5)/i,
  /^o[134](-mini)?($|[-.])/i,
  // Anthropic：Claude 3 起全系支持图像
  /^claude-/i,
  // Google：Gemini 全系多模态
  /^gemini/i,
  // 智谱：仅 V 系列接受图像（glm-4v / glm-4v-plus / glm-4.5v…）。
  // 实测 open.bigmodel.cn 的 glm-4.5（无 V）发图返回 code 1210
  // 「messages.content.type 取值范围 ['text']」——别把 4.5+/5.x 旗舰误判成视觉。
  /^glm-\d+(\.\d+)?v($|[-_.a-z])/i,
  // xAI：grok-4 起多模态
  /^grok-[4-9]/i,
  // 硅基流动等聚合端常见的视觉后缀
  /-v($|[-_.])/i,
];

export function inferModelImageInput(modelId: string): Array<'text' | 'image'> | undefined {
  const id = modelId.trim();
  if (!id) return undefined;
  for (const pattern of VISION_ID_PATTERNS) {
    if (pattern.test(id)) return ['text', 'image'];
  }
  return undefined;
}

/** effective 输入模态：显式库值优先，缺省回落推断。 */
export function effectiveModelInput(
  modelId: string,
  stored?: Array<'text' | 'image'>,
): Array<'text' | 'image'> | undefined {
  if (stored && stored.length > 0) return stored;
  return inferModelImageInput(modelId);
}
