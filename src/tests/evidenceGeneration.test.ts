import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vite-plus/test'
import { analyzeComparisons, createEvidencePairs, pairKey, type DirectComparison, type EvidencePair, type Relation } from '../ai/comparison'
import type { Evidence } from '../ai/evidence'
import type { MaterialPayload } from '../ai/store'
import {
  buildClairicRequest,
  buildClefBatches,
  CLEF_MAX_QUESTIONS,
  CLEF_MAX_REQUEST_BYTES,
  ModelContextLimitError,
  MODEL_SELECTORS,
  modelUsageStatus,
  parseClairicResponse,
  parseClefResponse,
} from '../ai/models'
import {
  assembleGeneratedDraft,
  buildCompletionRequest,
  buildGemmaRequest,
  GEMMA_MAX_REQUEST_BYTES,
  GEMMA_OUTPUT_SCHEMAS,
  GEMMA_SYSTEM_PROMPTS,
  finalizeDraftCompletion,
  GENERATION_VALIDATION_CODES,
  parseCompletionResponse,
  parseGemmaResponse,
  pipelineSettings,
  prepareDraftCompletion,
  type DraftCompletionPlan,
  type GeneratedSection,
  type GenerationInput,
  type GenerationSection,
  type SectionStates,
} from '../ai/generation'
import { statusOverview } from '../ai/overviewStatus'
import { messages as englishMessages } from '../l10n/en'

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
function judgment(a: string, b: string, relation: Relation): DirectComparison {
  return {
    pair_key: pairKey(a, b), evidence_ids: [a, b], relation, question_version: 'fixture',
    probabilities: { agree: Number(relation === 'agree'), disagree: Number(relation === 'disagree'), unrelated: Number(relation === 'unrelated'), uncertain: Number(relation === 'uncertain') },
    provider_diagnostics: null,
  }
}

const comparison = analyzeComparisons(evidence, [
  judgment('e1', 'e2', 'agree'), judgment('e1', 'e3', 'disagree'), judgment('e2', 'e3', 'uncertain'),
])
const input: GenerationInput = { evidence, comparison, language: 'zh-TW', sources }
const candidateId = comparison.consensus_groups[0].id
const cited = (text: string, ...evidence_ids: string[]) => ({ text, evidence_ids })

function consensusOutput() {
  return {
    Overview: [cited('😀第一句。第二句！', 'e1', 'e2')],
    items: [{ candidate_id: candidateId, evidence_ids: ['e1', 'e2'], kind: 'shared_position', Title: [cited('共同方向', 'e1')], description: [cited('兩份素材提出支持。', 'e1', 'e2')] }],
    rejected_candidates: [] as Array<{ candidate_id: string; reason: string }>,
  }
}

function disputeOutput(kind: 'contradiction' | 'opposition' | 'tension' = 'contradiction') {
  return {
    Overview: [cited('尚有分歧。', 'e1', 'e3')],
    items: [{
      kind,
      sides: [{ evidence_ids: ['e1'], claim: [cited('第一側。', 'e1')] }, { evidence_ids: ['e3'], claim: [cited('第二側。', 'e3')] }],
      comparison_conditions: [cited('可對照的條件。', 'e1', 'e3')],
      Title: [cited('兩側主張', 'e1', 'e3')],
      description: [cited('兩份素材意見不同。', 'e1', 'e3')],
    }],
  }
}

function positionsOutput() {
  return {
    Overview: [cited('呈現不同主張。', 'e1', 'e2')],
    items: [{
      group_id: 'g1', name: [cited('支持方案', 'e1')],
      Core_concern: null,
      opinions: [{ Title: [cited('方案一', 'e1')], description: [cited('支持方案一。', 'e1', 'e2')] }],
    }],
    exclusions: [{ evidence_id: 'e3', reason: '不足以納入此群' }],
  }
}

// 合成回應只檢查結構和邊界，不證明模型的語義品質。
function completion(content: unknown) {
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
    expect(request.input.state).toBe(raw)
    expect(request.input.fields.claims).toMatchObject({ type: 'list', items: 'text' })
    expect(request.input.options.return_state_text).toBe(true)
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

describe('Gemma 專項輸出與出處', () => {
  it('各專項僅接收完整引文與其職責所需的關係，不洩漏額外來源或比較 metadata', async () => {
    const extraSources = [material(28, '第四份原文中的條件。'), material(29, '第五份原文中的觀察。')]
    const extraEvidence = extraSources.map(source => anchored(`e${source.id - 24}`, source.id, source.content, source.content))
    const mixedEvidence = [evidence[2], extraEvidence[1], evidence[0], extraEvidence[0], evidence[1]]
    const analysis = analyzeComparisons(mixedEvidence, [
      judgment('e1', 'e2', 'agree'), judgment('e2', 'e3', 'agree'),
      judgment('e1', 'e3', 'disagree'), judgment('e1', 'e4', 'uncertain'),
      judgment('e2', 'e4', 'unrelated'),
    ], [{ pair_key: pairKey('e1', 'e5'), error_code: 'comparison_failed' }], [
      judgment('e2', 'e1', 'disagree'),
    ])
    const mixedInput: GenerationInput = { evidence: mixedEvidence, comparison: analysis, language: 'zh-TW', sources: [...sources, ...extraSources] }
    const original = structuredClone(mixedInput)
    for (const section of ['consensus', 'disputes', 'positions'] as const) {
      const request = buildGemmaRequest(section, mixedInput)
      const payload = JSON.parse(request.input.messages[1].content)
      expect(payload.section).toBe(section)
      expect(payload.language).toBe('zh-TW')
      expect(payload.evidence).toEqual([...mixedEvidence].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .map(({ id, material_id, quote }) => ({ id, material_id, quote })))
      expect(payload.comparison.direct_comparisons).toEqual(analysis.direct_comparisons.map(({ evidence_ids, relation }) => ({ evidence_ids, relation })))
      expect(payload.comparison.reverse_diagnostics).toEqual([{ evidence_ids: ['e2', 'e1'], relation: 'disagree' }])
      expect(payload.comparison.incomplete_pairs).toEqual(analysis.incomplete_pairs.map(({ evidence_ids, status }) => ({ evidence_ids, status })))
      expect(payload.comparison.incomplete_pairs).toEqual(expect.arrayContaining([
        { evidence_ids: ['e1', 'e5'], status: 'failed' },
        { evidence_ids: ['e3', 'e4'], status: 'missing' },
      ]))
      if (section === 'consensus') {
        expect(payload.comparison.consensus_groups).toEqual(analysis.consensus_groups.map(({ id, evidence_ids }) => ({ candidate_id: id, evidence_ids })))
        expect(payload.comparison).not.toHaveProperty('disputes')
      } else if (section === 'disputes') {
        expect(payload.comparison.disputes).toEqual(analysis.disputes.map(({ evidence_ids }) => ({ evidence_ids })))
        expect(payload.comparison).not.toHaveProperty('consensus_groups')
      } else {
        expect(payload.comparison).not.toHaveProperty('consensus_groups')
        expect(payload.comparison).not.toHaveProperty('disputes')
      }
      const serialized = JSON.stringify(payload)
      for (const secret of ['不能送出的其他原文', '其他秘密', 'https://example.org/a', '"raw_quote"', '"pair_key"', '"question_version"', '"probabilities"', '"provider_diagnostics"', '"candidate_paths"', '"diagnostics"', '"unclassified_evidence_ids"', '"pairs"']) {
        expect(serialized).not.toContain(secret)
      }
      expect(request.input).toMatchObject({ max_tokens: 8192, temperature: 0.2, chat_template_kwargs: { enable_thinking: false } })
      expect(request.request_bytes).toBeLessThanOrEqual(GEMMA_MAX_REQUEST_BYTES)
    }
    const output = positionsOutput()
    output.exclusions.push({ evidence_id: 'e4', reason: '不屬於此群' }, { evidence_id: 'e5', reason: '不屬於此群' })
    const parsed = await parseGemmaResponse('positions', completion(output), mixedInput)
    expect(parsed.diagnostics.comparison).toMatchObject({
      direct_relations: expect.arrayContaining([{ pair_key: pairKey('e1', 'e2'), evidence_ids: ['e1', 'e2'], relation: 'agree' }]),
      candidate_paths: expect.arrayContaining([expect.objectContaining({ pair_key: pairKey('e1', 'e3'), status: 'disagree' })]),
      incomplete_pairs: expect.arrayContaining([expect.objectContaining({ pair_key: pairKey('e1', 'e5'), status: 'failed', error_code: 'comparison_failed' })]),
    })
    expect(mixedInput).toEqual(original)
  })

  it('超出 context 上限時拒絕完整輸入而不截斷', () => {
    const hugeSources = [material(1, '甲'.repeat(9000)), material(2, '乙'.repeat(9000))]
    const hugeEvidence = hugeSources.map(source => anchored(`e${source.id}`, source.id, source.content, source.content))
    const hugeInput: GenerationInput = { evidence: hugeEvidence, comparison: analyzeComparisons(hugeEvidence, []), language: 'ja', sources: hugeSources }
    let diagnostic: unknown
    try {
      buildGemmaRequest('positions', hugeInput)
    } catch (error) {
      diagnostic = error
    }
    expect(diagnostic).toBeInstanceOf(ModelContextLimitError)
    expect(diagnostic).toMatchObject({ code: 'generation_context_limit', limit_bytes: GEMMA_MAX_REQUEST_BYTES })
    expect((diagnostic as ModelContextLimitError).request_bytes).toBeGreaterThan(GEMMA_MAX_REQUEST_BYTES)
  })

  it('21 段跨三素材的完整關係可容納於上限內，不因重複配對索引阻止全部專項', () => {
    const counts = [2, 3, 16]
    const denseSources = counts.map((count, index) => material(index + 25,
      Array.from({ length: count }, (_, item) => `證據${index}-${item}：${'可追溯的重要主張與完整適用條件'.repeat(12)}。`).join('\n')))
    const denseEvidence = denseSources.flatMap(source => source.content.split('\n').map(quote => {
      const start = source.content.indexOf(quote)
      return anchored(`e:${source.id}:${start}:${start + quote.length}`, source.id, source.content, quote, quote.slice(0, quote.indexOf('：')))
    }))
    const pairs = createEvidencePairs(denseEvidence)
    const direct = pairs.map((pair, index) => judgment(pair.a, pair.b, index === 0 ? 'agree' : index === 1 ? 'disagree' : index === 2 ? 'uncertain' : 'unrelated'))
    const analysis = analyzeComparisons(denseEvidence, direct)
    expect(pairs).toHaveLength(86)
    for (const section of ['consensus', 'disputes', 'positions'] as const) {
      const request = buildGemmaRequest(section, { evidence: denseEvidence, comparison: analysis, language: 'zh-TW', sources: denseSources })
      expect(request.request_bytes).toBeLessThanOrEqual(GEMMA_MAX_REQUEST_BYTES)
      const payload = JSON.parse(request.input.messages[1].content)
      expect(payload.evidence).toEqual([...denseEvidence].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .map(({ id, material_id, quote }) => ({ id, material_id, quote })))
      expect(payload.comparison.direct_comparisons).toEqual(analysis.direct_comparisons.map(({ evidence_ids, relation }) => ({ evidence_ids, relation })))
      expect(new Set([
        ...payload.comparison.direct_comparisons.map((item: { evidence_ids: [string, string] }) => pairKey(...item.evidence_ids)),
        ...payload.comparison.incomplete_pairs.map((item: { evidence_ids: [string, string] }) => pairKey(...item.evidence_ids)),
      ])).toEqual(new Set(pairs.map(pair => pair.key)))
    }
  })

  it('共識可拒絕弱候選，採用時 description 必須引用每個參與來源', async () => {
    const rejected = { Overview: null, items: [], rejected_candidates: [{ candidate_id: candidateId, reason: '無法提煉具體共同命題' }] }
    const result = await parseGemmaResponse('consensus', completion(rejected), input)
    expect(result.data).toEqual({ Overview: null, items: [] })
    expect(result.diagnostics).toMatchObject({ rejected_candidates: rejected.rejected_candidates })
    await expect(parseGemmaResponse('consensus', completion({ ...rejected, rejected_candidates: [] }), input)).rejects.toThrow('generation_incomplete_coverage')
    const missingSource = consensusOutput()
    missingSource.items[0].Title[0].evidence_ids = ['e1', 'e2']
    missingSource.items[0].description[0].evidence_ids = ['e1']
    await expect(parseGemmaResponse('consensus', completion(missingSource), input)).rejects.toThrow('generation_insufficient_group_citations')
    const wrongCandidate = consensusOutput()
    wrongCandidate.items[0].evidence_ids.push('e3')
    await expect(parseGemmaResponse('consensus', completion(wrongCandidate), input)).rejects.toThrow('generation_cross_candidate_citation')
    const wrongOverview = consensusOutput()
    wrongOverview.Overview[0].evidence_ids = ['e3']
    await expect(parseGemmaResponse('consensus', completion(wrongOverview), input)).rejects.toThrow('generation_cross_candidate_citation')
    const dishonest = consensusOutput()
    dishonest.rejected_candidates.push({ candidate_id: candidateId, reason: '同時拒絕' })
    await expect(parseGemmaResponse('consensus', completion(dishonest), input)).rejects.toThrow('generation_invalid_candidate')
  })

  it('共識三型僅存診斷，分類不冒充 Clef 判斷或改變 data 與引用格式', async () => {
    const commonSources = [material(41, '路線週末停駛。交通受限影響就醫。建議增加週末班次。'), material(42, '路線週末停駛。交通受限影響就醫。建議增加週末班次。')]
    const commonEvidence = commonSources.map((source, index) => anchored(`c${index + 1}`, source.id, source.content, source.content))
    const commonComparison = analyzeComparisons(commonEvidence, [judgment('c1', 'c2', 'agree')])
    const commonInput: GenerationInput = { evidence: commonEvidence, comparison: commonComparison, sources: commonSources, language: 'zh-TW' }
    const commonItems = [
      { kind: 'shared_fact', text: '路線週末停駛。' },
      { kind: 'shared_challenge', text: '交通受限影響就醫。' },
      { kind: 'shared_position', text: '建議增加週末班次。' },
    ].map(({ kind, text }) => ({
      kind, candidate_id: commonComparison.consensus_groups[0].id, evidence_ids: ['c1', 'c2'],
      Title: [cited(text, 'c1', 'c2')], description: [cited(text, 'c1', 'c2')],
    }))
    const result = await parseGemmaResponse('consensus', completion({ Overview: null, items: commonItems, rejected_candidates: [] }), commonInput)
    if (result.section !== 'consensus') throw new Error('unexpected section')
    expect(result.diagnostics.adopted.map(item => ({ kind: item.kind, classification_source: item.classification_source }))).toEqual([
      { kind: 'shared_fact', classification_source: 'gemma_proposal' },
      { kind: 'shared_challenge', classification_source: 'gemma_proposal' },
      { kind: 'shared_position', classification_source: 'gemma_proposal' },
    ])
    expect(result.data.items).toEqual(commonItems.map(item => ({ Title: item.Title[0].text, description: item.description[0].text })))
    expect(result.citation_map.map(item => item.pointer)).toEqual(commonItems.flatMap((_, index) => [`/consensus/items/${index}/Title`, `/consensus/items/${index}/description`]))
    const duplicate = { ...commonItems[0], kind: 'shared_challenge' }
    await expect(parseGemmaResponse('consensus', completion({ Overview: null, items: [commonItems[0], duplicate], rejected_candidates: [] }), commonInput)).rejects.toThrow('generation_invalid_candidate')
  })

  it('共識拒絕缺少或未知分類，以及模型偽造分類來源', async () => {
    for (const kind of [undefined, null, 'agree', 'shared_topic']) {
      const output = consensusOutput()
      const item: Record<string, unknown> = output.items[0]
      if (kind === undefined) delete item.kind
      else item.kind = kind
      await expect(parseGemmaResponse('consensus', completion(output), input)).rejects.toThrow('generation_invalid_schema')
    }
    const forged = consensusOutput()
    Object.assign(forged.items[0], { classification_source: 'clef' })
    await expect(parseGemmaResponse('consensus', completion(forged), input)).rejects.toThrow('generation_invalid_schema')
  })

  it('共享事實與挑戰仍受跨素材候選限制，不能用分類繞過支持範圍', async () => {
    for (const kind of ['shared_fact', 'shared_challenge']) {
      const outside = consensusOutput()
      outside.items[0].kind = kind
      outside.items[0].evidence_ids = ['e1', 'e3']
      outside.items[0].description[0].evidence_ids = ['e1', 'e3']
      await expect(parseGemmaResponse('consensus', completion(outside), input)).rejects.toThrow('generation_cross_candidate_citation')
      const single = consensusOutput()
      single.items[0].kind = kind
      single.items[0].evidence_ids = ['e1']
      single.items[0].description[0].evidence_ids = ['e1']
      await expect(parseGemmaResponse('consensus', completion(single), input)).rejects.toThrow('generation_insufficient_group_citations')
    }
  })

  it('共識引用宣告漏引即拒收，不自動修剪成可用子集', async () => {
    const sameSource = anchored('e4', 25, sources[0].content, '不能送出的其他原文。')
    const extended = [...evidence, sameSource]
    const extendedComparison = analyzeComparisons(extended, [...comparison.direct_comparisons, judgment('e2', 'e4', 'agree'), judgment('e3', 'e4', 'unrelated')])
    const selected = extendedComparison.consensus_groups.find(group => ['e1', 'e2', 'e4'].every(id => group.evidence_ids.includes(id)))!
    const extendedInput = { ...input, evidence: extended, comparison: extendedComparison }
    const output = consensusOutput()
    output.items[0].candidate_id = selected.id
    output.items[0].evidence_ids.push('e4')
    output.rejected_candidates = extendedComparison.consensus_groups.filter(group => group.id !== selected.id).map(group => ({ candidate_id: group.id, reason: '未採用' }))
    const response = completion(output)
    const original = structuredClone(response)
    await expect(parseGemmaResponse('consensus', response, extendedInput)).rejects.toThrow('generation_insufficient_group_citations')
    expect(response).toEqual(original)
    output.items[0].evidence_ids = ['e1', 'e2']
    const validSubset = await parseGemmaResponse('consensus', completion(output), extendedInput)
    expect(validSubset.diagnostics).toMatchObject({ adopted: [{ evidence_ids: ['e1', 'e2'] }] })
  })

  it('直接支持的較大候選可採用子集，缺邊與反例不能冒充支持', async () => {
    const extraSource = material(28, '額外可引用的內容。')
    const extraEvidence = anchored('e4', 28, extraSource.content, extraSource.content)
    const extended = [...evidence, extraEvidence]
    const extendedComparison = analyzeComparisons(extended, [
      judgment('e1', 'e2', 'agree'), judgment('e1', 'e4', 'agree'), judgment('e2', 'e4', 'agree'),
      judgment('e1', 'e3', 'disagree'),
    ])
    const selected = extendedComparison.consensus_groups.find(group => group.evidence_ids.includes('e1') && group.evidence_ids.includes('e2') && group.evidence_ids.includes('e4'))!
    const extendedInput: GenerationInput = { ...input, evidence: extended, sources: [...sources, extraSource], comparison: extendedComparison }
    const output = consensusOutput()
    output.items[0].candidate_id = selected.id
    output.rejected_candidates = extendedComparison.consensus_groups.filter(group => group.id !== selected.id).map(group => ({ candidate_id: group.id, reason: '不採用' }))
    expect((await parseGemmaResponse('consensus', completion(output), extendedInput)).data.items).toHaveLength(1)
    const forged = { ...comparison, consensus_groups: [{ id: 'bad', evidence_ids: ['e1', 'e2', 'e3'] }] }
    expect(() => buildGemmaRequest('consensus', { ...input, comparison: forged })).toThrow('generation_invalid_candidates')
  })

  it('沒有直接 disagree 也檢視張力，未支持的矛盾只保留提案且不冒充 Clef', async () => {
    const noDirect: GenerationInput = { ...input, comparison: analyzeComparisons(evidence, []) }
    for (const kind of ['tension', 'contradiction'] as const) {
      const result = await parseGemmaResponse('disputes', completion(disputeOutput(kind)), noDirect)
      expect(result.diagnostics).toMatchObject({
        items: [{ kind, classification_source: 'gemma_proposal', origin: 'gemma_proposal', formal_relation: null, relations: [{ evidence_ids: ['e1', 'e3'], relation: null, status: 'missing' }] }],
        coverage: expect.arrayContaining([{ evidence_id: 'e2', item_indices: [], status: 'not_selected', reason: 'not_selected_by_model' }]),
        comparison: { incomplete_pairs: expect.arrayContaining([expect.objectContaining({ pair_key: pairKey('e1', 'e3') })]) },
      })
    }
    const direct = await parseGemmaResponse('disputes', completion(disputeOutput()), input)
    expect(direct.diagnostics).toMatchObject({ items: [{ kind: 'contradiction', classification_source: 'gemma_proposal', origin: 'direct_clef', formal_relation: 'disagree', relations: [{ relation: 'disagree', status: 'direct' }] }] })
    const knownAgree = { ...input, comparison: analyzeComparisons(evidence, [judgment('e1', 'e3', 'agree')]) }
    await expect(parseGemmaResponse('disputes', completion(disputeOutput()), knownAgree)).rejects.toThrow('generation_invalid_dispute_relation')
    const counterfeit = disputeOutput()
    Object.assign(counterfeit.items[0], { origin: 'direct_clef' })
    await expect(parseGemmaResponse('disputes', completion(counterfeit), noDirect)).rejects.toThrow('generation_invalid_schema')
    const oneSided = disputeOutput()
    oneSided.items[0].description[0].evidence_ids = ['e1']
    await expect(parseGemmaResponse('disputes', completion(oneSided), input)).rejects.toThrow('generation_insufficient_group_citations')
    const sideMismatch = disputeOutput()
    sideMismatch.items[0].sides[0].claim[0].evidence_ids = ['e3']
    await expect(parseGemmaResponse('disputes', completion(sideMismatch), input)).rejects.toThrow('generation_cross_candidate_citation')
  })

  it('立場從多則意見的標題及敘述推導成員、來源、重疊與排除', async () => {
    const e4 = anchored('e4', 25, sources[0].content, '其他秘密。')
    const extended = [...evidence, e4]
    const extendedInput: GenerationInput = {
      ...input, evidence: extended,
      comparison: analyzeComparisons(extended, [
        judgment('e1', 'e2', 'agree'), judgment('e4', 'e2', 'agree'),
        judgment('e1', 'e3', 'disagree'), judgment('e2', 'e3', 'uncertain'),
      ]),
    }
    const base = positionsOutput()
    const output = {
      ...base,
      items: [{
        ...base.items[0], Core_concern: [cited('另一項條件。', 'e4')],
        opinions: [
          { Title: [cited('方案一', 'e1')], description: [cited('另一來源支持方案。', 'e2')] },
          { Title: [cited('另一項條件', 'e4')], description: [cited('原始主張。', 'e1')] },
        ],
      }, {
        group_id: 'g2', name: [cited('另一個明示面向', 'e1')], Core_concern: null,
        opinions: [{ Title: [cited('面向', 'e1')], description: [cited('來源主張。', 'e1')] }],
      }],
    }
    const result = await parseGemmaResponse('positions', completion(output), extendedInput)
    if (result.section !== 'positions') throw new Error('unexpected section')
    expect(result.data.items).toHaveLength(2)
    expect(result.data.items[0].Sources).toEqual([
      { Title: '來源25', href: 'https://example.org/a', material_id: 25 },
      { Title: '來源26', href: '/issues/13/source/26', material_id: 26 },
    ])
    expect(result.data.items[1].Sources.map(source => source.material_id)).toEqual([25])
    expect(result.diagnostics).toMatchObject({
      groups: [{ group_id: 'g1', evidence_ids: ['e1', 'e2', 'e4'] }, { group_id: 'g2', evidence_ids: ['e1'] }],
      coverage: [
        { evidence_id: 'e1', group_ids: ['g1', 'g2'], status: 'overlapping', reason: null },
        { evidence_id: 'e2', group_ids: ['g1'], status: 'grouped' },
        { evidence_id: 'e3', group_ids: [], status: 'excluded', reason: '不足以納入此群' },
        { evidence_id: 'e4', group_ids: ['g1'], status: 'grouped' },
      ],
    })
    expect(result.citation_map.map(entry => entry.pointer)).toEqual([
      '/positions/items/0/name', '/positions/items/0/Core_concern',
      '/positions/items/0/opinions/0/Title', '/positions/items/0/opinions/0/description',
      '/positions/items/0/opinions/1/Title', '/positions/items/0/opinions/1/description',
      '/positions/items/1/name', '/positions/items/1/opinions/0/Title',
      '/positions/items/1/opinions/0/description', '/positions/Overview',
    ])
    const missingOpinion = structuredClone(output)
    missingOpinion.items[0].opinions[1].Title[0].evidence_ids = ['e1']
    missingOpinion.items[0].Core_concern![0].evidence_ids = ['e1']
    await expect(parseGemmaResponse('positions', completion(missingOpinion), extendedInput)).rejects.toThrow('generation_incomplete_coverage')
    const missingExclusion = structuredClone(output)
    missingExclusion.exclusions = []
    await expect(parseGemmaResponse('positions', completion(missingExclusion), extendedInput)).rejects.toThrow('generation_incomplete_coverage')
    const doubleClaim = structuredClone(output)
    doubleClaim.exclusions.push({ evidence_id: 'e1', reason: '已分群仍排除' })
    await expect(parseGemmaResponse('positions', completion(doubleClaim), extendedInput)).rejects.toThrow('generation_incomplete_coverage')
  })

  it('拒絕未知、跨群、相反及舊格式引用，也不得由模型自行提供 Sources', async () => {
    const unknown = positionsOutput()
    unknown.items[0].name[0].evidence_ids = ['unknown']
    await expect(parseGemmaResponse('positions', completion(unknown), input)).rejects.toThrow('generation_unknown_evidence')
    const unknownOpinion = positionsOutput()
    unknownOpinion.items[0].opinions[0].Title[0].evidence_ids = ['unknown']
    await expect(parseGemmaResponse('positions', completion(unknownOpinion), input)).rejects.toThrow('generation_unknown_evidence')
    const crossed = positionsOutput()
    crossed.items[0].name[0].evidence_ids = ['e3']
    await expect(parseGemmaResponse('positions', completion(crossed), input)).rejects.toThrow('generation_cross_candidate_citation')
    const crossedCore = positionsOutput()
    const withCrossedCore = { ...crossedCore, items: [{ ...crossedCore.items[0], Core_concern: [cited('群外的主張。', 'e3')] }] }
    await expect(parseGemmaResponse('positions', completion(withCrossedCore), input)).rejects.toThrow('generation_cross_candidate_citation')
    const otherGroup = positionsOutput()
    otherGroup.items.push({
      group_id: 'g2', name: [cited('反對方案', 'e3')], Core_concern: null,
      opinions: [{ Title: [cited('另一立場', 'e3')], description: [cited('反對方案。', 'e3')] }],
    })
    otherGroup.exclusions = []
    const wrongGroupName = structuredClone(otherGroup)
    wrongGroupName.items[0].name[0].evidence_ids = ['e3']
    await expect(parseGemmaResponse('positions', completion(wrongGroupName), input)).rejects.toThrow('generation_cross_candidate_citation')
    const wrongGroupCore = { ...otherGroup, items: [{ ...otherGroup.items[0], Core_concern: [cited('另一群主張。', 'e3')] }, otherGroup.items[1]] }
    await expect(parseGemmaResponse('positions', completion(wrongGroupCore), input)).rejects.toThrow('generation_cross_candidate_citation')
    const conflicting = positionsOutput()
    conflicting.items[0].opinions[0].description[0].evidence_ids.push('e3')
    conflicting.exclusions = []
    await expect(parseGemmaResponse('positions', completion(conflicting), input)).rejects.toThrow('generation_contradictory_group')
    const invented = positionsOutput()
    Object.assign(invented.items[0], { Sources: [{ href: 'https://invented.invalid/' }] })
    await expect(parseGemmaResponse('positions', completion(invented), input)).rejects.toThrow('generation_invalid_schema')
    const oldFormat = positionsOutput()
    Object.assign(oldFormat.items[0], { evidence_ids: ['e1', 'e2'] })
    await expect(parseGemmaResponse('positions', completion(oldFormat), input)).rejects.toThrow('generation_invalid_schema')
    const noCitation = positionsOutput()
    noCitation.items[0].name[0].evidence_ids = []
    await expect(parseGemmaResponse('positions', completion(noCitation), input)).rejects.toThrow('generation_invalid_schema')
    const noOpinions = positionsOutput()
    noOpinions.items[0].opinions = []
    await expect(parseGemmaResponse('positions', completion(noOpinions), input)).rejects.toThrow('generation_invalid_schema')
    for (const exclusions of [
      [{ evidence_id: 'missing', reason: '未知' }],
      [{ evidence_id: 'e3', reason: '排除' }, { evidence_id: 'e3', reason: '重複排除' }],
      [{ evidence_id: 'e1', reason: '已採用' }, { evidence_id: 'e3', reason: '排除' }],
    ]) {
      await expect(parseGemmaResponse('positions', completion({ ...positionsOutput(), exclusions }), input)).rejects.toThrow('generation_incomplete_coverage')
    }
    await expect(parseGemmaResponse('positions', completion({ ...positionsOutput(), exclusions: [{ evidence_id: 'e3', reason: '  ' }] }), input)).rejects.toThrow('generation_invalid_schema')
  })

  it('逐句展開 UTF-16 座標及安全來源，分項組裝保留既有 pointer', async () => {
    const output = consensusOutput()
    output.Overview = [cited('😀日本語｡ 価格は1.5です．\r\nNext! 最後。', 'e1', 'e2')]
    const consensus = await parseGemmaResponse('consensus', completion(output), input)
    const positions = await parseGemmaResponse('positions', completion(positionsOutput()), input)
    const draft = await assembleGeneratedDraft([positions, consensus], input)
    expect(draft.data.disputes).toEqual({ Overview: null, items: [] })
    expect(draft.data.consensus.items).toEqual([{ Title: '共同方向', description: '兩份素材提出支持。' }])
    const text = draft.data.consensus.Overview!
    const ranges = draft.citation_map.filter(entry => entry.pointer === '/consensus/Overview')
    expect(ranges.map(entry => text.slice(entry.start, entry.end))).toEqual(['😀日本語｡', '価格は1.5です．', 'Next!', '最後。'])
    expect(ranges[0]).toMatchObject({ start: 0, end: '😀日本語｡'.length, unit: 'utf16', evidence_ids: ['e1', 'e2'] })
    expect(ranges[0].sources[0]).toMatchObject({ evidence_id: 'e1', material_id: 25, quote: evidence[0].quote, raw_quote: evidence[0].raw_quote, raw_span: evidence[0].raw_span, expanded_span: evidence[0].expanded_span })
    expect(ranges[0].sources[1].source.href).toBe('/issues/13/source/26')
    expect(draft.citation_map.some(entry => entry.pointer === '/positions/items/0/opinions/0/description')).toBe(true)
  })

  it('組裝拒絕重複、不同語言／比較／來源 context 與壞引用工件', async () => {
    const consensus = await parseGemmaResponse('consensus', completion(consensusOutput()), input)
    const disputes = await parseGemmaResponse('disputes', completion(disputeOutput()), input)
    expect(consensus.context_hash).toBe(disputes.context_hash)
    const reordered: GenerationInput = { sources, language: 'zh-TW', comparison, evidence }
    const replayed = await parseGemmaResponse('disputes', completion(disputeOutput()), reordered)
    expect(replayed.context_hash).toBe(consensus.context_hash)
    await expect(assembleGeneratedDraft([consensus, replayed], reordered)).resolves.toMatchObject({ data: { consensus: consensus.data, disputes: replayed.data } })
    await expect(assembleGeneratedDraft([consensus, consensus], input)).rejects.toThrow('generation_duplicate_section')
    const otherLanguage = await parseGemmaResponse('disputes', completion(disputeOutput()), { ...input, language: 'en' })
    await expect(assembleGeneratedDraft([consensus, otherLanguage], input)).rejects.toThrow('generation_context_mismatch')
    const otherComparison = { ...input, comparison: analyzeComparisons(evidence, []) }
    await expect(assembleGeneratedDraft([consensus], otherComparison)).rejects.toThrow('generation_context_mismatch')
    const changedMetadata = {
      ...input,
      comparison: { ...comparison, direct_comparisons: comparison.direct_comparisons.map((item, index) => index === 0 ? { ...item, provider_diagnostics: { fixture: 'changed' } } : item) },
    }
    expect(buildGemmaRequest('consensus', changedMetadata).input.messages[1].content).toBe(buildGemmaRequest('consensus', input).input.messages[1].content)
    await expect(assembleGeneratedDraft([consensus], changedMetadata)).rejects.toThrow('generation_context_mismatch')
    const changedSources = sources.map(source => source.id === 25 ? { ...source, source_name: '變更' } : source)
    await expect(assembleGeneratedDraft([consensus], { ...input, sources: changedSources })).rejects.toThrow('generation_context_mismatch')
    const broken = structuredClone(consensus)
    broken.citation_map[0].end++
    await expect(assembleGeneratedDraft([broken], input)).rejects.toThrow('generation_invalid_section_artifact')
  })

  it('三段可無發現，但不得以無項目的 Overview 取代可回查的發現', async () => {
    const fixtures: Record<GenerationSection, { Overview: unknown; items: unknown[]; [key: string]: unknown }> = {
      consensus: { Overview: null, items: [], rejected_candidates: [{ candidate_id: candidateId, reason: '不足' }] },
      disputes: { Overview: null, items: [] },
      positions: { Overview: null, items: [], exclusions: evidence.map(item => ({ evidence_id: item.id, reason: '不足' })) },
    }
    for (const section of ['consensus', 'disputes', 'positions'] as const) {
      const result = await parseGemmaResponse(section, completion(fixtures[section]), input)
      expect(result.data).toEqual({ Overview: null, items: [] })
      const invalid = { ...fixtures[section], Overview: [cited('沒有項目。', 'e1')] }
      await expect(parseGemmaResponse(section, completion(invalid), input)).rejects.toThrow('generation_invalid_schema')
    }
  })

  it('一至多個獨立項目均有效，重用候選不能以逐字重複項湊數', async () => {
    const dimensionSources = [
      material(31, '支持改善道路、增加照明與整修排水。'),
      material(32, '支持改善道路、增加照明與整修排水。'),
      material(33, '反對改善道路、增加照明與整修排水。'),
    ]
    const dimensionEvidence = dimensionSources.map((source, index) => anchored(`d${index + 1}`, source.id, source.content, source.content))
    const dimensionComparison = analyzeComparisons(dimensionEvidence, [
      judgment('d1', 'd2', 'agree'), judgment('d1', 'd3', 'disagree'), judgment('d2', 'd3', 'uncertain'),
    ])
    const dimensionInput: GenerationInput = { evidence: dimensionEvidence, comparison: dimensionComparison, sources: dimensionSources, language: 'zh-TW' }
    const dimensions = ['改善道路', '增加照明', '整修排水']
    const consensusItems = dimensions.map(dimension => ({
      candidate_id: dimensionComparison.consensus_groups[0].id,
      kind: 'shared_position',
      evidence_ids: ['d1', 'd2'],
      Title: [cited(dimension, 'd1', 'd2')],
      description: [cited(`兩份素材支持${dimension}。`, 'd1', 'd2')],
    }))
    const disputeItems = dimensions.map(dimension => ({
      kind: 'opposition',
      sides: [
        { evidence_ids: ['d1'], claim: [cited(`支持${dimension}。`, 'd1')] },
        { evidence_ids: ['d3'], claim: [cited(`反對${dimension}。`, 'd3')] },
      ],
      comparison_conditions: [cited(`均討論${dimension}。`, 'd1', 'd3')],
      Title: [cited(`${dimension}的選擇`, 'd1', 'd3')],
      description: [cited(`素材對${dimension}有不同主張。`, 'd1', 'd3')],
    }))
    const positionItems = [
      { group_id: 'g1', name: [cited('支持', 'd1')], Core_concern: null, opinions: [{ Title: [cited('支持設施改善', 'd1')], description: [cited('支持改善道路、照明與排水。', 'd1', 'd2')] }] },
      { group_id: 'g2', name: [cited('反對', 'd3')], Core_concern: null, opinions: [{ Title: [cited('反對設施改善', 'd3')], description: [cited('反對改善道路、照明與排水。', 'd3')] }] },
      { group_id: 'g3', name: [cited('照明', 'd2')], Core_concern: null, opinions: [{ Title: [cited('增加照明', 'd2')], description: [cited('支持增加照明。', 'd1', 'd2')] }] },
    ]
    for (const count of [1, 2, 3]) {
      const outputs: Record<GenerationSection, unknown> = {
        consensus: { Overview: null, items: consensusItems.slice(0, count), rejected_candidates: [] },
        disputes: { Overview: null, items: disputeItems.slice(0, count) },
        positions: { Overview: null, items: positionItems.slice(0, count), exclusions: count === 1 ? [{ evidence_id: 'd3', reason: '未採用' }] : [] },
      }
      for (const section of ['consensus', 'disputes', 'positions'] as const) {
        const result = await parseGemmaResponse(section, completion(outputs[section]), dimensionInput)
        expect(result.data.items).toHaveLength(count)
      }
    }
    const duplicate = structuredClone(consensusItems[0])
    duplicate.evidence_ids.reverse()
    duplicate.Title[0].text = `  ${duplicate.Title[0].text}  `
    await expect(parseGemmaResponse('consensus', completion({
      Overview: null, items: [consensusItems[0], duplicate], rejected_candidates: [],
    }), dimensionInput)).rejects.toThrow('generation_invalid_candidate')
  })

  it('完整單一 json 外框可解析，保留 CRLF、引用與字串內的反引號，不改寫原回應', async () => {
    const output = positionsOutput()
    output.items[0].opinions[0].description = [cited('文字可提及 ```json，不能因此截斷。', 'e1', 'e2')]
    const response = completion(output)
    delete (response.choices[0].message as Record<string, unknown>).refusal
    const wrapped = ` \r\n\`\`\`json\r\n${JSON.stringify(output)}\r\n\`\`\`\t\r\n`
    response.choices[0].message.content = wrapped
    const result = await parseGemmaResponse('positions', response, input)
    if (result.section !== 'positions') throw new Error('unexpected section')
    expect(result.data.items[0].opinions[0].description).toBe('文字可提及 ```json，不能因此截斷。')
    expect(result.data.items[0].Sources.map(source => source.material_id)).toEqual([25, 26])
    expect(result.citation_map.find(entry => entry.pointer === '/positions/items/0/opinions/0/description')?.evidence_ids).toEqual(['e1', 'e2'])
    expect(response.choices[0].message.content).toBe(wrapped)
  })

  it('無語言標記的完整單一外框可保留合法的空分區', async () => {
    const response = completion({ Overview: null, items: [] })
    response.choices[0].message.content = `\`\`\`\n${response.choices[0].message.content}\n\`\`\``
    const result = await parseGemmaResponse('disputes', response, input)
    expect(result.data).toEqual({ Overview: null, items: [] })
    expect(result.citation_map).toEqual([])
  })

  it('拒絕外框前後說明、多個／未閉合外框、其他語言及不合法 JSON，不猜測可用片段', async () => {
    const body = JSON.stringify({ Overview: null, items: [] })
    for (const content of [
      `說明\n\`\`\`json\n${body}\n\`\`\``,
      `\`\`\`json\n${body}\n\`\`\`\n說明`,
      `\`\`\`json\n${body}\n\`\`\`\n\`\`\`json\n${body}\n\`\`\``,
      `\`\`\`json\n${body}`,
      `\`\`\`json\n${body}\n\`\`\`\``,
      `\`\`\`javascript\n${body}\n\`\`\``,
      `\`\`\`json\n${body}${body}\n\`\`\``,
      '```json\n{"Overview":null,"items":[],}\n```',
    ]) {
      const response = completion(null)
      response.choices[0].message.content = content
      await expect(parseGemmaResponse('disputes', response, input)).rejects.toThrow('generation_invalid_json')
    }
  })

  it('完整外框內仍拒絕單句概述物件、空清單附概述及未知引用，不正規化欄位', async () => {
    const objectOverview = completion({ ...consensusOutput(), Overview: cited('共同方向。', 'e1', 'e2') })
    objectOverview.choices[0].message.content = `\`\`\`json\n${objectOverview.choices[0].message.content}\n\`\`\``
    await expect(parseGemmaResponse('consensus', objectOverview, input)).rejects.toThrow('generation_invalid_schema')
    const emptyWithOverview = completion({ Overview: [cited('沒有項目可供支持。', 'e1')], items: [] })
    emptyWithOverview.choices[0].message.content = `\`\`\`json\n${emptyWithOverview.choices[0].message.content}\n\`\`\``
    await expect(parseGemmaResponse('disputes', emptyWithOverview, input)).rejects.toThrow('generation_invalid_schema')
    const output = positionsOutput()
    output.items[0].opinions[0].description[0].evidence_ids = ['unknown']
    const unknown = completion(output)
    unknown.choices[0].message.content = `\`\`\`json\n${unknown.choices[0].message.content}\n\`\`\``
    await expect(parseGemmaResponse('positions', unknown, input)).rejects.toThrow('generation_unknown_evidence')
  })

  it('三段各自拒絕截斷、拒答與工具呼叫', async () => {
    const fixtures: Record<GenerationSection, unknown> = { consensus: consensusOutput(), disputes: disputeOutput(), positions: positionsOutput() }
    for (const section of ['consensus', 'disputes', 'positions'] as const) {
      const native = completion(fixtures[section])
      const message: Record<string, unknown> = native.choices[0].message
      delete message.refusal
      const nativeResult = await parseGemmaResponse(section, native, input)
      const pointer = `/${section}/items/0/${section === 'positions' ? 'name' : 'Title'}`
      expect(nativeResult.citation_map.find(entry => entry.pointer === pointer)?.sources.map(source => source.material_id)).toEqual(section === 'disputes' ? [25, 27] : [25])
      for (const reason of ['length', 'content_filter', 'tool_calls', 'unknown', '']) {
        const response = completion(fixtures[section])
        response.choices[0].finish_reason = reason
        await expect(parseGemmaResponse(section, response, input)).rejects.toThrow('generation_incomplete_completion')
      }
      const refusal = completion(fixtures[section])
      const refusalMessage: Record<string, unknown> = refusal.choices[0].message
      refusalMessage.refusal = 'refused'
      await expect(parseGemmaResponse(section, refusal, input)).rejects.toThrow('generation_refusal_or_invalid_message')
      refusalMessage.refusal = null
      refusalMessage.tool_calls = [{ id: 'unexpected' }]
      await expect(parseGemmaResponse(section, refusal, input)).rejects.toThrow('generation_refusal_or_invalid_message')
      await expect(parseGemmaResponse(section, { ...completion(fixtures[section]), truncated: true }, input)).rejects.toThrow('generation_invalid_completion')
      await expect(parseGemmaResponse(section, { ...completion(fixtures[section]), model: null }, input)).rejects.toThrow('generation_invalid_completion')
    }
  })

  it('送出及解析前核對來源、引文與 UTF-8／UTF-16 span 邊界', async () => {
    const falsified = [{ ...evidence[0], quote: '捏造的引文。' }, evidence[1], evidence[2]]
    const invalidInput = { ...input, evidence: falsified }
    expect(() => buildGemmaRequest('positions', invalidInput)).toThrow('generation_evidence_mismatch')
    await expect(parseGemmaResponse('positions', completion(positionsOutput()), invalidInput)).rejects.toThrow('generation_evidence_mismatch')
    const wrongSource = [{ ...evidence[0], material_id: 26 }, evidence[1], evidence[2]]
    expect(() => buildGemmaRequest('positions', { ...input, evidence: wrongSource })).toThrow('generation_evidence_mismatch')
    const wrongRaw = [{ ...evidence[0], raw_quote: '偽造' }, evidence[1], evidence[2]]
    expect(() => buildGemmaRequest('positions', { ...input, evidence: wrongRaw })).toThrow('generation_evidence_mismatch')
    await expect(parseGemmaResponse('positions', completion(positionsOutput()), { ...input, sources: sources.filter(source => source.id !== 25) })).rejects.toThrow('generation_missing_source')
    const prefix = sources[0].content.slice(0, evidence[0].raw_span.start)
    const rawEnd = prefix + evidence[0].raw_quote
    const utf8Evidence: Evidence[] = [{ ...evidence[0], raw_span: { start: new TextEncoder().encode(prefix).length, end: new TextEncoder().encode(rawEnd).length, unit: 'utf8' } }, evidence[1], evidence[2]]
    const utf8Input = { ...input, evidence: utf8Evidence }
    const result = await parseGemmaResponse('positions', completion(positionsOutput()), utf8Input)
    expect(result.citation_map.flatMap(entry => entry.sources).find(source => source.evidence_id === 'e1')?.raw_span.unit).toBe('utf8')
    utf8Evidence[0].raw_span.start++
    expect(() => buildGemmaRequest('positions', utf8Input)).toThrow('generation_evidence_mismatch')
    const splitSurrogate = [{ ...evidence[0], expanded_span: { ...evidence[0].expanded_span, start: evidence[0].expanded_span.start + 1 } }, evidence[1], evidence[2]]
    expect(() => buildGemmaRequest('positions', { ...input, evidence: splitSurrogate })).toThrow('generation_evidence_mismatch')
  })

  it('所有專項仍以完整比較工件核對配對覆蓋與正式候選關係', async () => {
    const fixtures: Record<GenerationSection, unknown> = { consensus: consensusOutput(), disputes: disputeOutput(), positions: positionsOutput() }
    const missing = { ...comparison, direct_comparisons: comparison.direct_comparisons.slice(1) }
    const wrongRelation = {
      ...comparison,
      direct_comparisons: comparison.direct_comparisons.map(item => item.pair_key === pairKey('e1', 'e2') ? { ...item, relation: 'uncertain' as const } : item),
    }
    const missingDispute = { ...comparison, disputes: [] }
    for (const section of ['consensus', 'disputes', 'positions'] as const) {
      for (const [invalid, code] of [
        [missing, 'generation_invalid_comparison'],
        [wrongRelation, 'generation_invalid_candidates'],
        [missingDispute, 'generation_invalid_candidates'],
      ] as const) {
        const invalidInput = { ...input, comparison: invalid }
        expect(() => buildGemmaRequest(section, invalidInput)).toThrow(code)
        await expect(parseGemmaResponse(section, completion(fixtures[section]), invalidInput)).rejects.toThrow(code)
      }
    }
  })
})

async function missingFieldsFixture() {
  const positions = positionsOutput()
  positions.items[0].opinions[0].description[0].evidence_ids = ['e1']
  positions.items[0].opinions.push({ Title: [cited('另一份支持意見', 'e2')], description: [cited('支持方案一。', 'e1')] })
  positions.items.push({
    group_id: 'g2', name: [cited('反對方案', 'e3')],
    Core_concern: null,
    opinions: [{ Title: [cited('另一種立場', 'e3')], description: [cited('反對方案一。', 'e3')] }],
  })
  positions.exclusions = []
  const sections: GeneratedSection[] = await Promise.all([
    parseGemmaResponse('consensus', completion(consensusOutput()), input),
    parseGemmaResponse('disputes', completion({ ...disputeOutput(), Overview: null }), input),
    parseGemmaResponse('positions', completion(positions), input),
  ])
  const draft = await assembleGeneratedDraft(sections, input)
  const plan = await prepareDraftCompletion(draft, sections, { consensus: 'completed', disputes: 'completed', positions: 'completed' }, input)
  return { sections, draft, plan }
}

function completionPatch(plan: DraftCompletionPlan) {
  return {
    base_hash: plan.base_hash,
    fills: plan.targets.map((target, index) => ({
      pointer: target.pointer,
      sentences: [cited(`😀補完${index}。另一句！`, target.evidence_ids[0])],
    })),
  }
}

describe('必要欄位補完與不可變 primary 工件', () => {
  it('補完固定驗證代碼可安全供工作流投影', () => {
    expect(GENERATION_VALIDATION_CODES).toEqual(expect.arrayContaining([
      'generation_invalid_completion_plan', 'generation_completion_base_mismatch',
      'generation_invalid_completion_patch', 'generation_completion_not_needed', 'generation_incomplete_draft',
    ]))
  })

  it('只補 null 白名單，保留原文、來源、順序及既有 citations，引用逐句展開', async () => {
    const { sections, draft, plan } = await missingFieldsFixture()
    const before = structuredClone({ sections, draft, plan })
    expect(plan.targets).toEqual([
      { pointer: '/disputes/Overview', evidence_ids: ['e1', 'e3'] },
      { pointer: '/positions/items/0/Core_concern', evidence_ids: ['e1', 'e2'] },
      { pointer: '/positions/items/1/Core_concern', evidence_ids: ['e3'] },
    ])
    const request = buildCompletionRequest(plan, input)
    const payload = JSON.parse(request.input.messages[1].content)
    expect(payload).toMatchObject({ operation: 'fill_missing_fields', base_hash: plan.base_hash, language: 'zh-TW', targets: plan.targets })
    expect(payload.evidence.map((item: { id: string }) => item.id)).toEqual(['e1', 'e2', 'e3'])
    expect(JSON.stringify(payload)).not.toContain('不能送出的其他原文')
    expect(JSON.stringify(payload)).not.toContain('其他秘密')
    expect(JSON.stringify(payload)).not.toContain('https://example.org/a')
    expect(payload.existing_data.positions.items[0]).not.toHaveProperty('Sources')
    expect(payload).not.toHaveProperty('consensus_items')
    expect(request.request_bytes).toBeLessThanOrEqual(GEMMA_MAX_REQUEST_BYTES)
    await expect(finalizeDraftCompletion(plan, input)).rejects.toThrow('generation_incomplete_draft')

    const result = await parseCompletionResponse(completion(completionPatch(plan)), plan, input)
    const reordered = completionPatch(plan)
    reordered.fills.reverse()
    expect(await parseCompletionResponse(completion(reordered), plan, input)).toEqual(result)
    const titleOnly = completionPatch(plan)
    titleOnly.fills[1].sentences[0].evidence_ids = ['e2']
    const titleOnlyResult = await parseCompletionResponse(completion(titleOnly), plan, input)
    expect(titleOnlyResult.citation_map.slice(draft.citation_map.length).find(entry => entry.pointer === '/positions/items/0/Core_concern')?.evidence_ids).toEqual(['e2'])
    const expected = structuredClone(draft.data)
    expected.disputes.Overview = '😀補完0。另一句！'
    expected.positions.items[0].Core_concern = '😀補完1。另一句！'
    expected.positions.items[1].Core_concern = '😀補完2。另一句！'
    expect(result.data).toEqual(expected)
    expect(result.data.consensus.Overview).toBe(draft.data.consensus.Overview)
    expect(result.data.positions.items.map(item => item.Sources)).toEqual(draft.data.positions.items.map(item => item.Sources))
    expect(result.evidence).toEqual(draft.evidence)
    expect(result.citation_map.slice(0, draft.citation_map.length)).toEqual(draft.citation_map)
    for (const [index, target] of plan.targets.entries()) {
      const text = `😀補完${index}。另一句！`
      const ranges = result.citation_map.slice(draft.citation_map.length).filter(entry => entry.pointer === target.pointer)
      expect(ranges.map(entry => text.slice(entry.start, entry.end))).toEqual([`😀補完${index}。`, '另一句！'])
      expect(ranges.every(entry => entry.evidence_ids.length === 1 && entry.evidence_ids[0] === target.evidence_ids[0])).toBe(true)
      expect(ranges[0].sources[0].quote).toBe(evidence.find(item => item.id === target.evidence_ids[0])!.quote)
    }
    expect({ sections, draft, plan }).toEqual(before)
    expect(result.data.positions.items.every(item => typeof item.Core_concern === 'string' && item.Core_concern.trim())).toBe(true)
    expect(['consensus', 'disputes', 'positions'].every(section => typeof result.data[section as GenerationSection].Overview === 'string' && result.data[section as GenerationSection].Overview.trim())).toBe(true)
  })

  it('共識 Overview 缺值補完保留事實／挑戰分型，分型綁定 base 且不改 data', async () => {
    const plans: DraftCompletionPlan[] = []
    for (const kind of ['shared_fact', 'shared_challenge']) {
      const primary = consensusOutput()
      primary.items[0].kind = kind
      const section = await parseGemmaResponse('consensus', completion({ ...primary, Overview: null }), input)
      const draft = await assembleGeneratedDraft([section], input)
      const plan = await prepareDraftCompletion(draft, [section], { consensus: 'completed', disputes: 'failed', positions: 'not_started' }, input)
      const before = structuredClone({ section, draft, plan })
      const payload = JSON.parse(buildCompletionRequest(plan, input).input.messages[1].content)
      expect(payload.consensus_items).toEqual([{ pointer: '/consensus/items/0', kind, evidence_ids: ['e1', 'e2'] }])
      expect(payload.existing_data.consensus.items[0]).not.toHaveProperty('kind')
      expect(plan.targets).toEqual([{ pointer: '/consensus/Overview', evidence_ids: ['e1', 'e2'] }])
      const result = await parseCompletionResponse(completion(completionPatch(plan)), plan, input)
      expect(result.data.consensus.items).toEqual(draft.data.consensus.items)
      expect(result.data.consensus.Overview).toBe('😀補完0。另一句！')
      expect(result.citation_map.slice(0, draft.citation_map.length)).toEqual(draft.citation_map)
      expect({ section, draft, plan }).toEqual(before)
      plans.push(plan)
    }
    expect(plans[0].base).toEqual(plans[1].base)
    expect(plans[0].base_hash).not.toBe(plans[1].base_hash)
    await expect(parseCompletionResponse(completion(completionPatch(plans[0])), plans[1], input)).rejects.toThrow('generation_completion_base_mismatch')
  })

  it('未知、重複、缺漏、非法指標、覆寫、額外操作及錯誤引用全部拒收，不部分套用', async () => {
    const { draft, plan } = await missingFieldsFixture()
    const original = structuredClone({ draft, plan })
    const valid = completionPatch(plan)
    const badGroup = structuredClone(valid)
    badGroup.fills[1].sentences[0].evidence_ids = ['e3']
    const badOverview = structuredClone(valid)
    badOverview.fills[0].sentences[0].evidence_ids = ['e2']
    const unknownEvidence = structuredClone(valid)
    unknownEvidence.fills[1].sentences[0].evidence_ids = ['missing']
    const noEvidence = structuredClone(valid)
    noEvidence.fills[1].sentences[0].evidence_ids = []
    const emptyText = structuredClone(valid)
    emptyText.fills[1].sentences[0].text = ' \n '
    const tests: Array<{ patch: unknown; code: string }> = [
      { patch: { ...valid, base_hash: 'stale' }, code: 'generation_completion_base_mismatch' },
      { patch: { ...valid, fills: valid.fills.slice(1) }, code: 'generation_invalid_completion_patch' },
      { patch: { ...valid, fills: [...valid.fills, valid.fills[0]] }, code: 'generation_invalid_completion_patch' },
      { patch: { ...valid, fills: [...valid.fills, { pointer: '/unknown', sentences: [cited('內容', 'e1')] }] }, code: 'generation_invalid_completion_patch' },
      { patch: { ...valid, fills: [valid.fills[0], { ...valid.fills[1], pointer: '/positions/items/00/Core_concern' }, valid.fills[2]] }, code: 'generation_invalid_completion_patch' },
      { patch: { ...valid, fills: [valid.fills[0], { ...valid.fills[1], pointer: '/positions/items/0/name' }, valid.fills[2]] }, code: 'generation_invalid_completion_patch' },
      { patch: { ...valid, fills: [valid.fills[0], { ...valid.fills[1], pointer: '/consensus/Overview' }, valid.fills[2]] }, code: 'generation_invalid_completion_patch' },
      { patch: { ...valid, data: { consensus: '覆寫' } }, code: 'generation_invalid_completion_patch' },
      { patch: { ...valid, operation: 'replace' }, code: 'generation_invalid_completion_patch' },
      { patch: { ...valid, fills: [valid.fills[0], { ...valid.fills[1], value: '覆寫' }, valid.fills[2]] }, code: 'generation_invalid_completion_patch' },
      { patch: badGroup, code: 'generation_cross_candidate_citation' },
      { patch: badOverview, code: 'generation_cross_candidate_citation' },
      { patch: unknownEvidence, code: 'generation_unknown_evidence' },
      { patch: noEvidence, code: 'generation_invalid_schema' },
      { patch: emptyText, code: 'generation_invalid_schema' },
      { patch: { ...valid, fills: [valid.fills[0], { ...valid.fills[1], sentences: [] }, valid.fills[2]] }, code: 'generation_invalid_schema' },
      { patch: { ...valid, fills: [valid.fills[0], { ...valid.fills[1], sentences: [{ text: '沒有來源' }] }, valid.fills[2]] }, code: 'generation_invalid_schema' },
      { patch: { ...valid, fills: [valid.fills[0], { ...valid.fills[1], sentences: [{ ...valid.fills[1].sentences[0], extra: true }] }, valid.fills[2]] }, code: 'generation_invalid_schema' },
    ]
    for (const { patch, code } of tests) {
      await expect(parseCompletionResponse(completion(patch), plan, input)).rejects.toThrow(code)
      expect(GENERATION_VALIDATION_CODES).toContain(code)
      expect({ draft, plan }).toEqual(original)
    }
  })

  it('綁定 primary、目標、完整 base 與語言／來源 context，任何舊工件不能重放', async () => {
    const { sections, draft, plan } = await missingFieldsFixture()
    const changedDraft = structuredClone(draft)
    changedDraft.data.consensus.items[0].Title = '被更改'
    await expect(prepareDraftCompletion(changedDraft, sections, { consensus: 'completed', disputes: 'completed', positions: 'completed' }, input)).rejects.toThrow('generation_invalid_completion_plan')
    await expect(prepareDraftCompletion(draft, sections, { consensus: 'failed', disputes: 'completed', positions: 'completed' }, input)).rejects.toThrow('generation_invalid_completion_plan')
    const altered = structuredClone(plan)
    altered.base.data.consensus.items[0].Title = '被更改'
    expect(() => buildCompletionRequest(altered, input)).toThrow('generation_completion_base_mismatch')
    await expect(parseCompletionResponse(completion(completionPatch(plan)), altered, input)).rejects.toThrow('generation_completion_base_mismatch')
    const alteredTargets = structuredClone(plan)
    alteredTargets.targets[1].evidence_ids.push('e3')
    expect(() => buildCompletionRequest(alteredTargets, input)).toThrow('generation_completion_base_mismatch')
    expect(() => buildCompletionRequest(plan, { ...input, language: 'en' })).toThrow('generation_context_mismatch')
    await expect(parseCompletionResponse(completion(completionPatch(plan)), plan, { ...input, language: 'ja' })).rejects.toThrow('generation_context_mismatch')
    const renamedSources = sources.map(source => source.id === 25 ? { ...source, source_name: '新名稱' } : source)
    expect(() => buildCompletionRequest(plan, { ...input, sources: renamedSources })).toThrow('generation_context_mismatch')
  })

  it('三語狀態文案參與 pipeline 及每個 section 的 context 指紋', async () => {
    const { plan } = await missingFieldsFixture()
    const baseline = await pipelineSettings()
    const catalog = englishMessages as unknown as Record<string, string>
    const original = catalog.ai_overview_failed
    try {
      catalog.ai_overview_failed = `${original} changed`
      expect((await pipelineSettings()).hashes.config).not.toBe(baseline.hashes.config)
      const generated = await parseGemmaResponse('disputes', completion(disputeOutput()), input)
      expect(generated.context_hash).not.toBe(plan.context_hash)
      expect(() => buildCompletionRequest(plan, input)).toThrow('generation_context_mismatch')
    } finally {
      catalog.ai_overview_failed = original
    }
  })

  it('專項提示或 schema 變更時，不可重用舊 context 與設定指紋', async () => {
    const { plan } = await missingFieldsFixture()
    const baseline = await pipelineSettings()
    const originalPrompt = GEMMA_SYSTEM_PROMPTS.positions
    try {
      GEMMA_SYSTEM_PROMPTS.positions = `${originalPrompt}\n`
      const changed = await pipelineSettings()
      expect(changed.hashes.gemma_prompt).not.toBe(baseline.hashes.gemma_prompt)
      expect(changed.hashes.parameters).not.toBe(baseline.hashes.parameters)
      expect(changed.hashes.config).not.toBe(baseline.hashes.config)
      expect(() => buildCompletionRequest(plan, input)).toThrow('generation_context_mismatch')
    } finally {
      GEMMA_SYSTEM_PROMPTS.positions = originalPrompt
    }
    const schema = GEMMA_OUTPUT_SCHEMAS.positions as unknown as Record<string, unknown>
    try {
      schema['x-fingerprint-test'] = true
      const changed = await pipelineSettings()
      expect(changed.hashes.gemma_schema).not.toBe(baseline.hashes.gemma_schema)
      expect(changed.hashes.config).not.toBe(baseline.hashes.config)
      expect(() => buildCompletionRequest(plan, input)).toThrow('generation_context_mismatch')
    } finally {
      delete schema['x-fingerprint-test']
    }
  })

  it('重新計算 base hash 仍須驗證 null 目標及共識分型索引與引用範圍', async () => {
    const { plan } = await missingFieldsFixture()
    const wrongTarget = structuredClone(plan)
    wrongTarget.targets[1].evidence_ids.push('e3')
    const missingKind = structuredClone(plan)
    missingKind.consensus_items = []
    const wrongKind = structuredClone(plan)
    Object.assign(wrongKind.consensus_items[0], { kind: 'shared_topic' })
    const wrongPointer = structuredClone(plan)
    wrongPointer.consensus_items[0].pointer = '/consensus/items/1'
    const wrongEvidence = structuredClone(plan)
    wrongEvidence.consensus_items[0].evidence_ids.push('e3')
    for (const forged of [wrongTarget, missingKind, wrongKind, wrongPointer, wrongEvidence]) {
      const stable = JSON.stringify({ context_hash: forged.context_hash, base: forged.base, targets: forged.targets, consensus_items: forged.consensus_items, status_overviews: forged.status_overviews }, (_key, value: unknown) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
        const object = value as Record<string, unknown>
        return Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]))
      })
      forged.base_hash = createHash('sha256').update(stable, 'utf8').digest('hex')
      expect(() => buildCompletionRequest(forged, input)).toThrow('generation_invalid_completion_plan')
      await expect(parseCompletionResponse(completion(completionPatch(forged)), forged, input)).rejects.toThrow('generation_invalid_completion_plan')
    }
  })

  it('補完請求使用相同 byte 上限，過大時拒絕而不截斷既有內容', async () => {
    const positions = positionsOutput()
    positions.items[0].opinions[0].description = [cited('長'.repeat(30_000), 'e1', 'e2')]
    const sections = await Promise.all([
      parseGemmaResponse('consensus', completion(consensusOutput()), input),
      parseGemmaResponse('disputes', completion(disputeOutput()), input),
      parseGemmaResponse('positions', completion(positions), input),
    ])
    const draft = await assembleGeneratedDraft(sections, input)
    const plan = await prepareDraftCompletion(draft, sections, { consensus: 'completed', disputes: 'completed', positions: 'completed' }, input)
    expect(() => buildCompletionRequest(plan, input)).toThrow(ModelContextLimitError)
    expect(plan.base.data.positions.items[0].opinions[0].description).toHaveLength(30_000)
  })

  it('三語空分區的三種處理狀態由程式產生，不偽造引用，也不用呼叫模型', async () => {
    for (const language of ['zh-TW', 'en', 'ja'] as const) {
      const localizedInput = { ...input, language }
      const empty = { Overview: null, items: [], rejected_candidates: [{ candidate_id: candidateId, reason: '不足' }] }
      const section = await parseGemmaResponse('consensus', completion(empty), localizedInput)
      const draft = await assembleGeneratedDraft([section], localizedInput)
      const plan = await prepareDraftCompletion(draft, [section], { consensus: 'no_findings', disputes: 'failed', positions: 'not_started' }, localizedInput)
      expect(plan.targets).toEqual([])
      expect(plan.status_overviews).toEqual([
        { section: 'consensus', pointer: '/consensus/Overview', kind: 'status', status: 'no_findings', origin: 'program' },
        { section: 'disputes', pointer: '/disputes/Overview', kind: 'status', status: 'failed', origin: 'program' },
        { section: 'positions', pointer: '/positions/Overview', kind: 'status', status: 'not_started', origin: 'program' },
      ])
      expect(() => buildCompletionRequest(plan, localizedInput)).toThrow('generation_completion_not_needed')
      const final = await finalizeDraftCompletion(plan, localizedInput)
      expect(final.data.consensus.Overview).toBe(statusOverview('consensus', 'no_findings', language))
      expect(final.data.disputes.Overview).toBe(statusOverview('disputes', 'failed', language))
      expect(final.data.positions.Overview).toBe(statusOverview('positions', 'not_started', language))
      expect(final.citation_map).toEqual([])
      expect(draft.data.consensus.Overview).toBeNull()
      const emptyOutputs: Record<GenerationSection, unknown> = {
        consensus: empty,
        disputes: { Overview: null, items: [] },
        positions: { Overview: null, items: [], exclusions: evidence.map(item => ({ evidence_id: item.id, reason: '不足' })) },
      }
      for (const sectionName of ['consensus', 'disputes', 'positions'] as const) {
        for (const state of ['no_findings', 'failed', 'not_started'] as const) {
          const primary = state === 'no_findings' ? [await parseGemmaResponse(sectionName, completion(emptyOutputs[sectionName]), localizedInput)] : []
          const states: SectionStates = { consensus: 'not_started', disputes: 'not_started', positions: 'not_started' }
          states[sectionName] = state
          const emptyDraft = await assembleGeneratedDraft(primary, localizedInput)
          const emptyPlan = await prepareDraftCompletion(emptyDraft, primary, states, localizedInput)
          const emptyFinal = await finalizeDraftCompletion(emptyPlan, localizedInput)
          expect(emptyFinal.data[sectionName].Overview).toBe(statusOverview(sectionName, state, language))
          expect(emptyPlan.status_overviews.find(item => item.section === sectionName)).toMatchObject({ status: state, origin: 'program' })
          expect(emptyFinal.citation_map).toEqual([])
        }
      }
    }
  })

  it('完整 primary 直接完成，保留所有引用且不發出補完請求', async () => {
    const positions = positionsOutput()
    const fullPositions = { ...positions, items: positions.items.map(item => ({ ...item, Core_concern: [cited('關注方案一。', 'e1')] })) }
    const sections = await Promise.all([
      parseGemmaResponse('consensus', completion(consensusOutput()), input),
      parseGemmaResponse('disputes', completion(disputeOutput()), input),
      parseGemmaResponse('positions', completion(fullPositions), input),
    ])
    const draft = await assembleGeneratedDraft(sections, input)
    const plan = await prepareDraftCompletion(draft, sections, { consensus: 'completed', disputes: 'completed', positions: 'completed' }, input)
    expect(plan.targets).toEqual([])
    expect(plan.status_overviews).toEqual([])
    expect(() => buildCompletionRequest(plan, input)).toThrow('generation_completion_not_needed')
    await expect(parseCompletionResponse(completion({ base_hash: plan.base_hash, fills: [] }), plan, input)).rejects.toThrow('generation_completion_not_needed')
    const final = await finalizeDraftCompletion(plan, input)
    expect(final).toEqual(draft)
    expect(final.data.positions.items[0].Core_concern).toBe('關注方案一。')
  })

  it('補完沿用 stop、拒答、工具呼叫及單一完整 JSON 外框規則', async () => {
    const { plan } = await missingFieldsFixture()
    const patch = completionPatch(plan)
    const fenced = completion(patch)
    fenced.choices[0].message.content = ` \r\n\`\`\`json\r\n${JSON.stringify(patch)}\r\n\`\`\`\r\n`
    await expect(parseCompletionResponse(fenced, plan, input)).resolves.toMatchObject({ data: { disputes: { Overview: '😀補完0。另一句！' } } })
    const invalidFence = completion(patch)
    invalidFence.choices[0].message.content = `說明\n\`\`\`json\n${JSON.stringify(patch)}\n\`\`\``
    await expect(parseCompletionResponse(invalidFence, plan, input)).rejects.toThrow('generation_invalid_json')
    const truncated = completion(patch)
    truncated.choices[0].finish_reason = 'length'
    await expect(parseCompletionResponse(truncated, plan, input)).rejects.toThrow('generation_incomplete_completion')
    const refusal = completion(patch)
    ;(refusal.choices[0].message as Record<string, unknown>).refusal = 'refused'
    await expect(parseCompletionResponse(refusal, plan, input)).rejects.toThrow('generation_refusal_or_invalid_message')
    const tools = completion(patch)
    ;(tools.choices[0].message as Record<string, unknown>).tool_calls = [{ id: 'tool' }]
    await expect(parseCompletionResponse(tools, plan, input)).rejects.toThrow('generation_refusal_or_invalid_message')
  })
})
