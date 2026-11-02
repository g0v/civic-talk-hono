import { describe, expect, it } from 'vite-plus/test'
import { actualCallCost, estimateCall, requestProvenance } from '../ai/pricing'

describe('Workers AI 整數微美元計價', () => {
  it('按已版本化價目計算且不足一微美元進位', () => {
    expect(actualCallCost('@cf/cloudflare/clairic', { usage: { input_tokens: 1_000_000, output_tokens: 0 } })).toBe(100_000)
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 1_000_000, output_tokens: 0 } })).toBe(240_000)
    expect(actualCallCost('@cf/openai/gpt-oss-120b', { usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } })).toBe(1_100_000)
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 1, output_tokens: 0 } })).toBe(1)
    expect(estimateCall('@cf/cloudflare/clairic', { state: 'abcdef' })).toBeGreaterThan(0)
  })

  it('沒有完整或可信用量時保留未知，不以零元結算', () => {
    expect(actualCallCost('@cf/cloudflare/clairic', {})).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 123 } })).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clairic', { usage: { input_tokens: 5, output_tokens: 0, passes: 'unknown' } })).toBeNull()
    expect(actualCallCost('@cf/openai/gpt-oss-120b', { usage: { prompt_tokens: 20, completion_tokens: -1 } })).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 } })).toBeNull()
  })

  it('生成模型只按明確的原生輸入及輸出用量計價，不重複計算推理', () => {
    const selector = '@cf/openai/gpt-oss-120b'
    expect(actualCallCost(selector, { usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } })).toBe(350_000)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 1_000_000 } })).toBe(750_000)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 1, completion_tokens: 0 } })).toBe(1)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 1 } })).toBe(1)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 4570, completion_tokens: 2654, total_tokens: 7224, prompt_tokens_details: { cached_tokens: 0 } } })).toBe(3590)
    expect(actualCallCost(selector, {
      usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180, reasoning_tokens: 50, completion_tokens_details: { reasoning_tokens: 50 } },
      choices: [{ message: { reasoning: '推理內容', reasoning_content: '推理內容' } }],
    })).toBe(95)
    expect(actualCallCost(selector, { usage: { input_tokens: 100, output_tokens: 80 } })).toBe(95)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 0 } })).toBe(0)
  })

  it('生成模型用量缺漏、無效或互相衝突時費用維持未知', () => {
    const selector = '@cf/openai/gpt-oss-120b'
    expect(actualCallCost(selector, {})).toBeNull()
    expect(actualCallCost(selector, { usage: {} })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: null, input_tokens: 0, completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 2, input_tokens: 1, completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 1, output_tokens: 2 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: null } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 1 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: '1', completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 0.5 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 0 } })).toBeNull()
  })

  it('預留包含實際帶有結構描述的完整請求與全部生成輸出', () => {
    const selector = '@cf/openai/gpt-oss-120b'
    const request = {
      messages: [{ role: 'user', content: '測試' }],
      max_tokens: 8192,
      response_format: { type: 'json_schema', json_schema: { type: 'object', properties: { result: { type: 'string' } } } },
    }
    const inputBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength
    const expected = Math.ceil(((inputBytes * 4 + 4096) * 35 + 8192 * 75) / 100)
    const withoutSchema = { ...request, response_format: undefined }
    expect(estimateCall(selector, request, request.max_tokens)).toBe(expected)
    expect(estimateCall(selector, request, request.max_tokens)).toBeGreaterThan(estimateCall(selector, withoutSchema, withoutSchema.max_tokens))
    expect(estimateCall(selector, request, request.max_tokens) - estimateCall(selector, request, 0)).toBe(6144)
  })

  it('provider 未提供權重版本時不把 selector 冒充不可變版本', async () => {
    expect(await requestProvenance('@cf/cloudflare/clairic', { state: '測試' }, { model: 'clairic' })).toMatchObject({ provider_model: 'clairic', provider_revision: null, provider_request_id: null })
  })
})
