import { describe, expect, it } from 'vite-plus/test'
import { actualCallCost, estimateCall, requestProvenance } from '../ai/pricing'

describe('Workers AI 整數微美元計價', () => {
  it('按已版本化價目計算且不足一微美元進位', () => {
    expect(actualCallCost('@cf/cloudflare/clairic', { usage: { input_tokens: 1_000_000, output_tokens: 0 } })).toBe(100_000)
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 1_000_000, output_tokens: 0 } })).toBe(240_000)
    expect(actualCallCost('@cf/google/gemma-4-26b-a4b-it', { usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } })).toBe(400_000)
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 1, output_tokens: 0 } })).toBe(1)
    expect(estimateCall('@cf/cloudflare/clairic', { state: 'abcdef' })).toBeGreaterThan(0)
  })

  it('沒有完整或可信用量時保留未知，不以零元結算', () => {
    expect(actualCallCost('@cf/cloudflare/clairic', {})).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: 123 } })).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clairic', { usage: { input_tokens: 5, output_tokens: 0, passes: 'unknown' } })).toBeNull()
    expect(actualCallCost('@cf/google/gemma-4-26b-a4b-it', { usage: { prompt_tokens: 20, completion_tokens: -1 } })).toBeNull()
    expect(actualCallCost('@cf/cloudflare/clef', { usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 0 } })).toBeNull()
  })

  it('provider 未提供權重版本時不把 selector 冒充不可變版本', async () => {
    expect(await requestProvenance('@cf/cloudflare/clairic', { state: '測試' }, { model: 'clairic' })).toMatchObject({ provider_model: 'clairic', provider_revision: null, provider_request_id: null })
  })
})
