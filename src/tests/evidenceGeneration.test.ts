import { describe, expect, it } from 'vite-plus/test'
import { createEvidencePairs, pairKey, type EvidencePair } from '../ai/comparison'
import type { Evidence } from '../ai/evidence'
import type { MaterialPayload } from '../ai/store'
import {
  buildClairicRequest,
  buildClefBatches,
  CLAIRIC_INSTRUCTIONS,
  CLEF_MAX_QUESTIONS,
  CLEF_MAX_REQUEST_BYTES,
  ModelContextLimitError,
  MODEL_SELECTORS,
  modelUsageStatus,
  parseClairicResponse,
  parseClefResponse,
} from '../ai/models'
import {
  buildGemmaRequest,
  GEMMA_MAX_REQUEST_BYTES,
  parseGemmaResponse,
  type GenerationCandidates,
} from '../ai/generation'

function anchored(id: string, material_id: number, content: string, quote: string, raw_quote = quote): Evidence {
  const quoteStart = content.indexOf(quote)
  const rawStart = content.indexOf(raw_quote, quoteStart)
  return {
    id,
    material_id,
    quote,
    raw_quote,
    raw_span: { start: rawStart, end: rawStart + raw_quote.length, unit: 'utf16' },
    expanded_span: { start: quoteStart, end: quoteStart + quote.length, unit: 'utf16' },
  }
}

function material(id: number, content: string, source_url: string | null = null): MaterialPayload {
  return { id, issue_id: 13, content, source_name: `來源${id}`, source_url, content_hash: 'fixture-hash' }
}

const sources = [
  material(25, '不能送出的其他原文。😀支持方案一。其他秘密。', 'https://example.org/a'),
  material(26, '未摘錄的原文。另一份支持方案一。', 'javascript:alert(1)'),
  material(27, '未摘錄的第三份。反對方案一。'),
]
const evidence = [
  anchored('e1', 25, sources[0].content, '😀支持方案一。', '支持方案一'),
  anchored('e2', 26, sources[1].content, '另一份支持方案一。', '支持方案一'),
  anchored('e3', 27, sources[2].content, '反對方案一。', '反對方案一'),
]
const candidates: GenerationCandidates = {
  consensus: [{ id: 'support', evidence_ids: ['e1', 'e2'] }],
  disputes: [{ id: 'conflict', evidence_ids: ['e1', 'e3'] }],
  positions: [{ id: 'position-25', evidence_ids: ['e1'] }, { id: 'position-27', evidence_ids: ['e3'] }],
}

const cited = (text: string, ...evidence_ids: string[]) => ({ text, evidence_ids })
function generated() {
  return {
    consensus: {
      Overview: [cited('😀第一句。第二句！', 'e1', 'e2')],
      items: [{ candidate_id: 'support', Title: [cited('共同方向', 'e1')], description: [cited('兩份素材提出支持。', 'e1', 'e2')] }],
    },
    disputes: {
      Overview: [cited('尚有分歧。', 'e1', 'e3')],
      items: [{ candidate_id: 'conflict', Title: [cited('支持與反對', 'e1', 'e3')], description: [cited('兩份素材意見不同。', 'e1', 'e3')] }],
    },
    positions: {
      Overview: [cited('呈現不同主張。', 'e1', 'e3')],
      items: [{
        candidate_id: 'position-25',
        name: [cited('支持方案', 'e1')],
        Core_concern: null,
        opinions: [{ Title: [cited('方案一', 'e1')], description: [cited('支持方案一。', 'e1')] }],
      }],
    },
  }
}

// 僅測試拒絕條件，不把這些合成回應當作 provider 或模型品質證明。
function completion(content: unknown = generated()) {
  return {
    model: MODEL_SELECTORS.gemma,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content), refusal: null } }],
  }
}

function validClefAnswer(choice: 'agree' | 'disagree' | 'unrelated' | 'uncertain' = 'agree') {
  return { type: 'choice', choice, confidence: 0.9, probabilities: { agree: choice === 'agree' ? 1 : 0, disagree: choice === 'disagree' ? 1 : 0, unrelated: choice === 'unrelated' ? 1 : 0, uncertain: choice === 'uncertain' ? 1 : 0 } }
}

describe('固定模型與 Clairic 合約', () => {
  it('逐份 state 原樣傳入 list/text primitive，要求 state_text', () => {
    const raw = '  繁中 😀\r\n原文  '
    const request = buildClairicRequest(raw)
    expect(request.selector).toBe('@cf/cloudflare/clairic')
    expect(request.input).toEqual({ model: 'clairic', state: raw, fields: { claims: { type: 'list', items: 'text', instructions: CLAIRIC_INSTRUCTIONS } }, options: { return_state_text: true } })
    expect(() => buildClairicRequest('')).toThrow('clairic_state_out_of_bounds')
    expect(() => buildClairicRequest('x'.repeat(48 * 1024 + 1))).toThrow('clairic_state_out_of_bounds')
  })

  it('接收完整的 list 回應與 null；拒絕截斷、錯 state 或壞答案', () => {
    const response = { model: 'clairic', state_text: '原文', truncated: false, answers: { claims: { type: 'list', value: ['原文'], spans: [[0, 2]] } }, usage: { input_tokens: 10, output_tokens: 0 } }
    expect(parseClairicResponse(response, '原文')).toEqual(response)
    expect(parseClairicResponse({ ...response, answers: { claims: { type: 'list', value: null } } }).answers.claims.value).toBeNull()
    expect(() => parseClairicResponse({ ...response, truncated: true })).toThrow('clairic_invalid_response')
    expect(() => parseClairicResponse(response, '不同原文')).toThrow('clairic_state_mismatch')
    expect(() => parseClairicResponse({ ...response, answers: { claims: { type: 'list', value: ['原文', 1] } } })).toThrow('clairic_invalid_answer')
    expect(parseClairicResponse({ ...response, model: 'provider-revision-1' }).model).toBe('provider-revision-1')
    expect(() => parseClairicResponse({ ...response, model: null })).toThrow('clairic_invalid_response')
  })

  it('Clairic 用量缺漏或異常不抹除答案，但不得誤稱用量已報告', () => {
    const response = { model: 'clairic', truncated: false, answers: { claims: { type: 'list', value: ['原文'], spans: [[0, 2]] } } }
    for (const providerUsage of [undefined, null, { input_tokens: 10 }, { input_tokens: 10, output_tokens: '0' }, { input_tokens: -1, output_tokens: 0 }, { input_tokens: 10, output_tokens: 0, passes: 'invalid' }]) {
      expect(parseClairicResponse({ ...response, usage: providerUsage }).answers.claims.value).toEqual(['原文'])
      expect(modelUsageStatus(providerUsage)).toBe(providerUsage === undefined ? 'missing' : 'malformed')
    }
    expect(modelUsageStatus({ input_tokens: 10, output_tokens: 0 })).toBe('reported')
  })
})

describe('Clef 對稱比較批次', () => {
  it('以固定排序分批且不遺漏配對，對調 A/B 使用相同請求及 pair key', () => {
    const many = Array.from({ length: 20 }, (_, index) => anchored(`e${String(index).padStart(2, '0')}`, index + 1, `第${index}段。`, `第${index}段。`))
    const pairs = createEvidencePairs(many)
    const batches = buildClefBatches(many, pairs)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flatMap(batch => batch.pairs).map(pair => pair.pair_key).sort()).toEqual(pairs.map(pair => pair.key).sort())
    for (const batch of batches) {
      expect(batch.selector).toBe('@cf/cloudflare/clef')
      expect(batch.pairs.length).toBeLessThanOrEqual(CLEF_MAX_QUESTIONS)
      expect(batch.request_bytes).toBeLessThanOrEqual(CLEF_MAX_REQUEST_BYTES)
    }
    const reversed: EvidencePair[] = pairs.map(pair => ({ ...pair, a: pair.b, b: pair.a })).reverse()
    expect(buildClefBatches(many, reversed)).toEqual(batches)
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'))
  })

  it('拒絕重複、同素材、偽造 pair key 或無法完整容納的單題', () => {
    const pair = createEvidencePairs(evidence)[0]
    expect(() => buildClefBatches(evidence, [pair, { ...pair, a: pair.b, b: pair.a }])).toThrow('clef_duplicate_pair')
    expect(() => buildClefBatches(evidence, [{ ...pair, key: 'fake' }])).toThrow('clef_invalid_pair')
    const sameSource = [{ ...evidence[0] }, { ...evidence[1], material_id: evidence[0].material_id }]
    expect(() => buildClefBatches(sameSource, [{ key: pairKey('e1', 'e2'), a: 'e1', b: 'e2' }])).toThrow('clef_invalid_pair')
    const large = [{ ...evidence[0], quote: '字'.repeat(5000) }, evidence[1]]
    expect(() => buildClefBatches(large, [{ key: pairKey('e1', 'e2'), a: 'e1', b: 'e2' }])).toThrow('clef_single_pair_context_limit')
  })

  it('保留題序及四選項機率，缺題、非法答案和明示截斷都拒絕', () => {
    const batch = buildClefBatches(evidence, [createEvidencePairs(evidence)[0]])[0]
    const response = { model: 'clef', answers: { q0: validClefAnswer('agree') }, usage: { input_tokens: 100, output_tokens: 0 } }
    const [comparison] = parseClefResponse(response, batch)
    expect(comparison).toMatchObject({ pair_key: batch.pairs[0].pair_key, evidence_ids: batch.pairs[0].evidence_ids, relation: 'agree', provider_diagnostics: { question_id: 'q0', truncated: null } })
    expect(parseClefResponse({ ...response, model: 'provider-revision-2' }, batch)[0].provider_diagnostics).toMatchObject({ model: 'provider-revision-2' })
    expect(() => parseClefResponse({ ...response, model: null }, batch)).toThrow('clef_invalid_response')
    expect(() => parseClefResponse({ ...response, truncated: true }, batch)).toThrow('clef_invalid_response')
    expect(() => parseClefResponse({ ...response, answers: {} }, batch)).toThrow('clef_missing_answer')
    expect(() => parseClefResponse({ ...response, answers: { q0: { ...validClefAnswer(), choice: 'disagree' } } }, batch)).toThrow('clef_invalid_choice')
    expect(() => parseClefResponse({ ...response, answers: { q0: { ...validClefAnswer(), probabilities: { agree: 1 } } } }, batch)).toThrow('clef_invalid_probabilities')
    expect(() => parseClefResponse({ ...response, answers: { q0: validClefAnswer(), q1: validClefAnswer() } }, batch)).toThrow('clef_missing_answer')
    for (const providerUsage of [undefined, null, { input_tokens: 100 }, { input_tokens: 100, output_tokens: -1 }]) {
      const [accepted] = parseClefResponse({ ...response, usage: providerUsage }, batch)
      expect(accepted.relation).toBe('agree')
      expect(accepted.provider_diagnostics).toMatchObject({ usage: null, usage_status: providerUsage === undefined ? 'missing' : 'malformed' })
    }
  })
})

describe('Gemma 結構化輸出與出處', () => {
  it('只傳驗證後 evidence 和候選，超限明確拒絕', () => {
    const request = buildGemmaRequest(evidence, candidates, 'zh-TW', sources)
    expect(request.selector).toBe('@cf/google/gemma-4-26b-a4b-it')
    const serialized = JSON.stringify(request.input)
    expect(serialized).not.toContain('不能送出的其他原文')
    expect(serialized).not.toContain('其他秘密')
    expect(serialized).not.toContain('https://example.org/a')
    expect(serialized).toContain('😀支持方案一。')
    expect(request.request_bytes).toBeLessThanOrEqual(GEMMA_MAX_REQUEST_BYTES)

    const hugeSources = [material(1, '甲'.repeat(9000)), material(2, '乙'.repeat(9000))]
    const hugeEvidence = hugeSources.map(source => anchored(`e${source.id}`, source.id, source.content, source.content))
    const hugeCandidates: GenerationCandidates = { consensus: [{ id: 'c', evidence_ids: ['e1', 'e2'] }], disputes: [], positions: [] }
    let diagnostic: unknown
    try {
      buildGemmaRequest(hugeEvidence, hugeCandidates, 'ja', hugeSources)
    } catch (error) {
      diagnostic = error
    }
    expect(diagnostic).toBeInstanceOf(ModelContextLimitError)
    expect(diagnostic).toMatchObject({ code: 'generation_context_limit', limit_bytes: GEMMA_MAX_REQUEST_BYTES })
    expect((diagnostic as ModelContextLimitError).request_bytes).toBeGreaterThan(GEMMA_MAX_REQUEST_BYTES)
  })

  it('原生 stop 回應省略 refusal 時仍驗證 JSON、候選與出處', () => {
    const response = completion()
    const message: Record<string, unknown> = response.choices[0].message
    delete message.refusal
    const result = parseGemmaResponse(response, evidence, candidates, sources)
    expect(result.data.consensus.items).toEqual([{ Title: '共同方向', description: '兩份素材提出支持。' }])
    expect(result.citation_map[0].sources.map(source => source.material_id)).toEqual([25, 26])
  })

  it('程式展開來源與逐句 UTF-16 offsets，連結只使用快照安全 URL 或本站實際素材頁', () => {
    const result = parseGemmaResponse(completion(), evidence, candidates, sources)
    expect(result.data.consensus.items).toEqual([{ Title: '共同方向', description: '兩份素材提出支持。' }])
    expect(result.data.positions.items[0].Sources).toEqual([{ Title: '來源25', href: 'https://example.org/a', material_id: 25 }])
    const overviews = result.citation_map.filter(entry => entry.pointer === '/consensus/Overview')
    expect(overviews.map(entry => result.data.consensus.Overview!.slice(entry.start, entry.end))).toEqual(['😀第一句。', '第二句！'])
    expect(overviews[0]).toMatchObject({ start: 0, end: '😀第一句。'.length, unit: 'utf16', evidence_ids: ['e1', 'e2'] })
    expect(overviews[0].sources[0]).toMatchObject({ evidence_id: 'e1', material_id: 25, quote: evidence[0].quote, raw_quote: evidence[0].raw_quote, raw_span: evidence[0].raw_span, expanded_span: evidence[0].expanded_span })
    expect(overviews[0].sources[1].source.href).toBe('/issues/13/source/26')
    expect(result.citation_map.some(entry => entry.pointer === '/positions/items/0/opinions/0/description')).toBe(true)
  })

  it('中英日標點、換行與小數都按原字串計算逐句區間', () => {
    const output = generated()
    output.consensus.Overview = [cited('😀日本語｡ 価格は1.5です．\r\nNext! 最後。', 'e1', 'e2')]
    const result = parseGemmaResponse(completion(output), evidence, candidates, sources)
    const text = result.data.consensus.Overview!
    const mapped = result.citation_map.filter(entry => entry.pointer === '/consensus/Overview')
    expect(mapped.map(entry => text.slice(entry.start, entry.end))).toEqual(['😀日本語｡', '価格は1.5です．', 'Next!', '最後。'])
    expect(mapped.every(entry => entry.evidence_ids.length === 2)).toBe(true)
  })

  it('拒絕截斷、明示拒答、未知完成原因、工具呼叫及非原始 JSON', () => {
    for (const reason of ['length', 'content_filter', 'tool_calls', 'unknown', '']) {
      const response = completion()
      response.choices[0].finish_reason = reason
      expect(() => parseGemmaResponse(response, evidence, candidates, sources)).toThrow('generation_incomplete_completion')
    }
    const refusal = completion()
    const refusalMessage: Record<string, unknown> = refusal.choices[0].message
    refusalMessage.refusal = 'refused'
    expect(() => parseGemmaResponse(refusal, evidence, candidates, sources)).toThrow('generation_refusal_or_invalid_message')
    refusalMessage.refusal = null
    refusalMessage.tool_calls = [{ id: 'unexpected' }]
    expect(() => parseGemmaResponse(refusal, evidence, candidates, sources)).toThrow('generation_refusal_or_invalid_message')
    const fenced = completion()
    fenced.choices[0].message.content = '```json\n{}\n```'
    expect(() => parseGemmaResponse(fenced, evidence, candidates, sources)).toThrow('generation_invalid_json')
    expect(() => parseGemmaResponse({ ...completion(), truncated: true }, evidence, candidates, sources)).toThrow('generation_invalid_completion')
    expect(parseGemmaResponse({ ...completion(), model: 'provider-revision-3' }, evidence, candidates, sources).citation_map.length).toBeGreaterThan(0)
    expect(() => parseGemmaResponse({ ...completion(), model: null }, evidence, candidates, sources)).toThrow('generation_invalid_completion')
    expect(() => parseGemmaResponse({ response: generated() }, evidence, candidates, sources)).toThrow('generation_invalid_completion')
  })

  it('拒絕未知證據、無引用、跨候選引用、模型填入 URL 與偽造群組', () => {
    const unknown = generated()
    unknown.consensus.Overview[0].evidence_ids = ['unknown']
    expect(() => parseGemmaResponse(completion(unknown), evidence, candidates, sources)).toThrow('generation_unknown_evidence')
    const missing = generated()
    missing.positions.items[0].name[0].evidence_ids = []
    expect(() => parseGemmaResponse(completion(missing), evidence, candidates, sources)).toThrow('generation_invalid_schema')
    const crossed = generated()
    crossed.positions.items[0].name[0].evidence_ids = ['e3']
    expect(() => parseGemmaResponse(completion(crossed), evidence, candidates, sources)).toThrow('generation_cross_candidate_citation')
    const invented = generated()
    invented.consensus.items[0].candidate_id = evidence[0].id
    expect(() => parseGemmaResponse(completion(invented), evidence, candidates, sources)).toThrow('generation_invalid_candidate')
    const extra = generated()
    Object.assign(extra.positions.items[0], { Sources: [{ href: 'https://invented.invalid/' }] })
    expect(() => parseGemmaResponse(completion(extra), evidence, candidates, sources)).toThrow('generation_invalid_schema')
    const singleSource = generated()
    singleSource.consensus.items[0].description[0].evidence_ids = ['e1']
    expect(() => parseGemmaResponse(completion(singleSource), evidence, candidates, sources)).toThrow('generation_insufficient_group_citations')
  })

  it('缺候選只允許 null overview、空清單；不可用存在卻不屬該類候選的證據', () => {
    const noCandidates: GenerationCandidates = { consensus: [], disputes: [], positions: [] }
    const empty = { consensus: { Overview: null, items: [] }, disputes: { Overview: null, items: [] }, positions: { Overview: null, items: [] } }
    expect(parseGemmaResponse(completion(empty), evidence, noCandidates, sources).data).toEqual(empty)
    const invalid = { ...empty, consensus: { Overview: [cited('沒有候選。', 'e1')], items: [] } }
    expect(() => parseGemmaResponse(completion(invalid), evidence, noCandidates, sources)).toThrow('generation_cross_candidate_citation')
  })

  it('送出與解析前均核對素材歸屬、原始與展開引文和 Unicode offset', () => {
    const falsified = [{ ...evidence[0], quote: '捏造的引文。' }, evidence[1], evidence[2]]
    expect(() => buildGemmaRequest(falsified, candidates, 'en', sources)).toThrow('generation_evidence_mismatch')
    expect(() => parseGemmaResponse(completion(), falsified, candidates, sources)).toThrow('generation_evidence_mismatch')
    const wrongSource = [{ ...evidence[0], material_id: 26 }, evidence[1], evidence[2]]
    expect(() => buildGemmaRequest(wrongSource, candidates, 'en', sources)).toThrow('generation_evidence_mismatch')
    const wrongRaw = [{ ...evidence[0], raw_quote: '偽造' }, evidence[1], evidence[2]]
    expect(() => buildGemmaRequest(wrongRaw, candidates, 'en', sources)).toThrow('generation_evidence_mismatch')
    const missing = sources.filter(source => source.id !== 25)
    expect(() => parseGemmaResponse(completion(), evidence, candidates, missing)).toThrow('generation_missing_source')
    const prefix = sources[0].content.slice(0, evidence[0].raw_span.start)
    const rawEnd = prefix + evidence[0].raw_quote
    const utf8Evidence: Evidence[] = [{ ...evidence[0], raw_span: { start: new TextEncoder().encode(prefix).length, end: new TextEncoder().encode(rawEnd).length, unit: 'utf8' } }, evidence[1], evidence[2]]
    expect(parseGemmaResponse(completion(), utf8Evidence, candidates, sources).citation_map[0].sources[0].raw_span.unit).toBe('utf8')
    utf8Evidence[0].raw_span.start++
    expect(() => buildGemmaRequest(utf8Evidence, candidates, 'en', sources)).toThrow('generation_evidence_mismatch')
  })
})
