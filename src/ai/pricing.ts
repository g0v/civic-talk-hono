import { sha256 } from './source'

/** 2026-11-02 Workers AI 公開價目；不是帳單硬上限。 */
export const PRICING_VERSION = 'workers-ai-2026-11-02-gpt-oss-120b'
export const PRICES = {
  '@cf/cloudflare/clairic': { input: 10, output: 0 },
  '@cf/cloudflare/clef': { input: 24, output: 0 },
  '@cf/openai/gpt-oss-120b': { input: 35, output: 75 },
} as const
export type ModelSelector = keyof typeof PRICES

// 價目單位為 1/100 微美元／token，換算時只使用整數並無條件進位。
function cost(selector: ModelSelector, input: number, output: number): number {
  const price = PRICES[selector]
  return Math.ceil((input * price.input + output * price.output) / 100)
}

/**
 * 為未知 tokenizer／schema／包裝保守預留；這是估算，不宣稱 provider 硬限制。
 * UTF-8 bytes × 4 加固定開銷；生成模型再預留明確的最大輸出 token。
 */
export function estimateCall(selector: ModelSelector, input: unknown, maxOutputTokens = 0): number {
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength
  const inputBound = bytes * 4 + 4096
  return cost(selector, inputBound, maxOutputTokens)
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

// 同時回報原生名稱與別名時，兩者都必須有效且一致，避免以衝突數字低估費用。
function tokenCount(usage: Record<string, unknown>, primary: string, alias: string): number | null {
  const first = primary in usage ? count(usage[primary]) : null
  const second = alias in usage ? count(usage[alias]) : null
  if ((primary in usage && first === null) || (alias in usage && second === null)) return null
  if (first !== null && second !== null && first !== second) return null
  return first ?? second
}

/** 僅 provider 明確提供的完整 token 用量可以結算；缺少或異常維持未知。 */
export function actualCallCost(selector: ModelSelector, response: unknown): number | null {
  if (!response || typeof response !== 'object' || !('usage' in response)) return null
  const usage = response.usage
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  if (['state_tokens', 'image_tokens', 'schema_tokens', 'passes'].some(key => u[key] !== undefined && count(u[key]) === null)) return null
  const input = selector === '@cf/openai/gpt-oss-120b' ? tokenCount(u, 'prompt_tokens', 'input_tokens') : count(u.input_tokens)
  const output = selector === '@cf/openai/gpt-oss-120b' ? tokenCount(u, 'completion_tokens', 'output_tokens') : count(u.output_tokens)
  // 推理 token 已包含在 completion_tokens，不可再重複計費。
  if (input === null || output === null) return null
  if (selector === '@cf/openai/gpt-oss-120b' && 'total_tokens' in u && count(u.total_tokens) !== input + output) return null
  const price = PRICES[selector]
  if (!Number.isSafeInteger(input * price.input + output * price.output)) return null
  return cost(selector, input, output)
}

export async function requestProvenance(selector: ModelSelector, input: unknown, response: unknown): Promise<Record<string, unknown>> {
  const raw = response && typeof response === 'object' ? response as Record<string, unknown> : {}
  const metadataString = (value: unknown): string | null => typeof value === 'string' && value.length <= 300 ? value : null
  return {
    model_selector: selector,
    provider_model: metadataString(raw.model),
    provider_revision: null,
    provider_request_id: metadataString(raw.id),
    provider_system_fingerprint: metadataString(raw.system_fingerprint),
    request: input,
    request_sha256: await sha256(JSON.stringify(input)),
    pricing_version: PRICING_VERSION,
  }
}
