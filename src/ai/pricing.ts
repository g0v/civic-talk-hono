import { sha256 } from './source'

/** 2026-10-29 Workers AI 公開價目；不是帳單硬上限。 */
export const PRICING_VERSION = 'workers-ai-2026-10-29'
export const PRICES = {
  '@cf/cloudflare/clairic': { input: 10, output: 0 },
  '@cf/cloudflare/clef': { input: 24, output: 0 },
  '@cf/google/gemma-4-26b-a4b-it': { input: 10, output: 30 },
} as const
export type ModelSelector = keyof typeof PRICES

// 價目單位為 1/100 微美元／token，換算時只使用整數並無條件進位。
function cost(selector: ModelSelector, input: number, output: number): number {
  const price = PRICES[selector]
  return Math.ceil((input * price.input + output * price.output) / 100)
}

/**
 * 為未知 tokenizer／schema／包裝保守預留；這是估算，不宣稱 provider 硬限制。
 * UTF-8 bytes × 4 加固定開銷；Gemma 再預留明確的最大輸出 token。
 */
export function estimateCall(selector: ModelSelector, input: unknown, maxOutputTokens = 0): number {
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength
  const inputBound = bytes * 4 + 4096
  return cost(selector, inputBound, maxOutputTokens)
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** 僅 provider 明確提供的完整 token 用量可以結算；缺少或異常維持未知。 */
export function actualCallCost(selector: ModelSelector, response: unknown): number | null {
  if (!response || typeof response !== 'object' || !('usage' in response)) return null
  const usage = response.usage
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  if (['state_tokens', 'image_tokens', 'schema_tokens', 'passes'].some(key => u[key] !== undefined && count(u[key]) === null)) return null
  const input = count(selector === '@cf/google/gemma-4-26b-a4b-it' ? u.input_tokens ?? u.prompt_tokens : u.input_tokens)
  const output = count(selector === '@cf/google/gemma-4-26b-a4b-it' ? u.output_tokens ?? u.completion_tokens : u.output_tokens)
  if (input === null || output === null) return null
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
