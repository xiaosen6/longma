/**
 * 供应商 HTTP 错误的安全分类（对齐 Cindy #12c5f86ae 模式）：从原始错误文本中
 * 提取**结构化脱敏**的分类信息——`HTTP 状态码 + 类别`，绝不转发可能含
 * key/响应体/用户内容的原始 adapter 字符串进用户提示。
 *
 * 分类 → 用户行动项的完整映射仍由 friendly-error.ts 承接，这里只做
 * 「安全提取 + 分类」这一层（ Cindy diagnosticFetch 的 renderer 侧对应物）。
 */
import { redactSensitiveText } from '@fundet/shared/error-redaction';

export type ProviderErrorCategory =
  | 'authentication'
  | 'permission'
  | 'rate_limit'
  | 'provider_unavailable'
  | 'request_rejected'
  | 'network'
  | 'unknown';

export interface ProviderErrorDiagnostic {
  /** HTTP 状态码（400-599 才提取；成功握手状态不进失败原因，Cindy #4ea75478f） */
  httpStatus?: number;
  category: ProviderErrorCategory;
  /** 脱敏后的原始文本摘要（≤200 字符，经 redactSensitiveText） */
  safeSummary: string;
  /** 中文类别名 */
  categoryLabel: string;
}

const CATEGORY_LABELS: Record<ProviderErrorCategory, string> = {
  authentication: 'API Key 无效或过期',
  permission: '无权访问该模型/资源',
  rate_limit: '请求过于频繁（限流）',
  provider_unavailable: '服务商暂时不可用',
  request_rejected: '请求被服务商拒绝',
  network: '网络连接失败',
  unknown: '未知错误',
};

/** HTTP 状态码 → 分类（只覆盖确定映射，不确定归 unknown） */
function classifyHttpStatus(status: number): ProviderErrorCategory {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 402) return 'permission';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider_unavailable';
  if (status >= 400) return 'request_rejected';
  return 'unknown';
}

/** 无状态码的文本线索 → 分类 */
function classifyByText(raw: string): ProviderErrorCategory | null {
  const lower = raw.toLowerCase();
  if (/api[ _]?key|invalid[ _]key|unauthorized|鉴权失败|key 无效/.test(lower)) return 'authentication';
  if (/rate[ _]?limit|too many requests|限流|频率/.test(lower)) return 'rate_limit';
  if (/quota|余额不足|insufficient|欠费/.test(lower)) return 'permission';
  if (/timeout|timed out|econnrefused|enotfound|econnreset|fetch failed|网络|连接失败|stream broke|stream ended/.test(lower)) return 'network';
  if (/service unavailable|internal server error|bad gateway|服务不可用/.test(lower)) return 'provider_unavailable';
  return null;
}

export function classifyProviderError(raw: string): ProviderErrorDiagnostic {
  // 只取 400-599 区间的状态码（成功握手状态不该出现在失败原因里）
  const statusMatch = /(?:HTTP|http|status[code]?)\s*[=:]?\s*(4\d\d|5\d\d)/.exec(raw);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
  const category =
    (httpStatus !== undefined ? classifyHttpStatus(httpStatus) : null) ??
    classifyByText(raw) ??
    'unknown';
  return {
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    category,
    safeSummary: redactSensitiveText(raw).slice(0, 200),
    categoryLabel: CATEGORY_LABELS[category],
  };
}

/** 完整用户话术：类别行动项 + （有状态码时）附码；末尾保留脱敏摘要供排查 */
export function formatProviderErrorAction(raw: string): string {
  const d = classifyProviderError(raw);
  const parts: string[] = [];
  switch (d.category) {
    case 'authentication':
      parts.push('请检查 设置 → 模型供应商 里的 API Key 是否正确、是否已过期。');
      break;
    case 'permission':
      parts.push('该 Key 可能无权访问此模型（或账户余额不足），请到服务商控制台确认。');
      break;
    case 'rate_limit':
      parts.push('请求太频繁被限流，请等几秒再重试。');
      break;
    case 'provider_unavailable':
      parts.push('服务商暂时不可用（可能维护中），请稍后再试。');
      break;
    case 'request_rejected':
      parts.push('请求被服务商拒绝，请检查模型名称与参数。');
      break;
    case 'network':
      parts.push('网络连接失败，请检查网络或代理设置后重试。');
      break;
    default:
      break;
  }
  const statusSuffix = d.httpStatus !== undefined ? `（HTTP ${d.httpStatus}）` : '';
  const summary = d.safeSummary && d.safeSummary !== raw ? `\n${d.safeSummary}` : '';
  const original = d.category === 'unknown' ? `\n${d.safeSummary}` : summary;
  return parts.length > 0 ? `${d.categoryLabel}${statusSuffix}：${parts[0]}${original}` : raw;
}
