import { describe, expect, it } from 'vite-plus/test'
import { actualCallCost, estimateCall, requestProvenance } from '../ai/pricing'

describe('Workers AI 整數微美元計價', () => {
  it('按已版本化價目計算且不足一微美元進位', () => {
    expect(actualCallCost('@cf/cloudflare/clairic', { usage: { input_tokens: 1_000_000, output_tokens: 0 } })).toBe(100_000)
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 1_000_000, output_tokens: 0 } })).toBe(240_000)
    expect(actualCallCost('@cf/google/gemma-4-26b-a4b-it', { usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } })).toBe(400_000)
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 1, output_tokens: 0 } })).toBe(1)
  })

  it('沒有完整或可信用量時保留未知，不以零元結算', () => {
    expect(actualCallCost('@cf/cloudflare/clairic', {})).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 123 } })).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clairic', { usage: { input_tokens: 5, output_tokens: 0, passes: 'unknown' } })).toBeNull()
    expect(actualCallCost('@cf/google/gemma-4-26b-a4b-it', { usage: { prompt_tokens: 20, completion_tokens: -1 } })).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 } })).toBeNull()
  })

  it('生成模型只按明確的原生輸入及輸出用量計價，不重複計算推理', () => {
    const selector = '@cf/google/gemma-4-26b-a4b-it'
    expect(actualCallCost(selector, { usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } })).toBe(100_000)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 1_000_000 } })).toBe(300_000)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 1, completion_tokens: 0 } })).toBe(1)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 1 } })).toBe(1)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 4570, completion_tokens: 2654, total_tokens: 7224 } })).toBe(1254)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 200, completion_tokens: 80 } })).toBe(44)
    expect(actualCallCost(selector, {
      usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180, completion_tokens_details: { reasoning_tokens: 50 } },
      choices: [{ message: { role: 'assistant', content: '{}', reasoning: '推理內容' } }],
    })).toBe(34)
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 0 } })).toBe(0)
    // 別名仍可結算；同時存在時必須一致。
    expect(actualCallCost(selector, { usage: { input_tokens: 200, output_tokens: 80 } })).toBe(44)
    expect(actualCallCost(selector, { usage: { input_tokens: 200, prompt_tokens: 200, output_tokens: 80, completion_tokens: 80 } })).toBe(44)
  })

  it('生成模型用量缺漏、無效或互相衝突時費用維持未知', () => {
    const selector = '@cf/google/gemma-4-26b-a4b-it'
    expect(actualCallCost(selector, {})).toBeNull()
    expect(actualCallCost(selector, { usage: {} })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { input_tokens: 0, prompt_tokens: null, completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, input_tokens: null, completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { input_tokens: 1, prompt_tokens: 2, completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, output_tokens: 2, completion_tokens: 1 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: null } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 1 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: '1', completion_tokens: 0 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: 0, completion_tokens: 0.5 } })).toBeNull()
    expect(actualCallCost(selector, { usage: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 0 } })).toBeNull()
  })

  it('預留包含實際帶有結構描述的完整請求與全部生成輸出', () => {
    const selector = '@cf/google/gemma-4-26b-a4b-it'
    const request = {
      messages: [
        { role: 'system', content: '只回傳有證據支持的結果。' },
        { role: 'user', content: JSON.stringify({ text: '測試' }) },
      ],
      max_completion_tokens: 8192,
      temperature: 0.2,
      chat_template_kwargs: { enable_thinking: false },
      stream: false,
      response_format: { type: 'json_schema', json_schema: { name: 'evidence_consensus', strict: true, schema: { type: 'object', properties: { result: { type: 'string' } } } } },
    }
    const inputBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength
    const inputBound = inputBytes * 4 + 4096
    const expected = Math.ceil((inputBound * 10 + 8192 * 30) / 100)
    const { schema: _schema, ...formatWithoutSchema } = request.response_format.json_schema
    const withoutSchema = { ...request, response_format: { ...request.response_format, json_schema: formatWithoutSchema } }
    expect(estimateCall(selector, request, request.max_completion_tokens)).toBe(expected)
    expect(estimateCall(selector, request, request.max_completion_tokens)).toBeGreaterThan(estimateCall(selector, withoutSchema, withoutSchema.max_completion_tokens))
    expect(estimateCall(selector, request, request.max_completion_tokens) - estimateCall(selector, request, 0)).toBe(expected - Math.ceil(inputBound * 10 / 100))
  })

  it('provider 未提供權重版本時不把 selector 冒充不可變版本', async () => {
    expect(await requestProvenance('@cf/cloudflare/clairic', { state: '測試' }, { model: 'clairic' })).toMatchObject({ provider_model: 'clairic', provider_revision: null, provider_request_id: null })
  })
})
