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
  buildGemmaRequest,
  GEMMA_MAX_REQUEST_BYTES,
  parseGemmaResponse,
  type GenerationInput,
  type GenerationSection,
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
    items: [{ candidate_id: candidateId, evidence_ids: ['e1', 'e2'], Title: [cited('共同方向', 'e1')], description: [cited('兩份素材提出支持。', 'e1', 'e2')] }],
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
      group_id: 'g1', evidence_ids: ['e1', 'e2'], name: [cited('支持方案', 'e1')],
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
  it('各專項只接收驗證引文與完整關係，超出 context 不截斷', () => {
    for (const section of ['consensus', 'disputes', 'positions'] as const) {
      const request = buildGemmaRequest(section, input)
      const payload = JSON.parse(request.input.messages[1].content)
      expect(payload.evidence).toHaveLength(evidence.length)
      expect(payload.comparison.direct_comparisons).toHaveLength(comparison.direct_comparisons.length)
      expect(payload.comparison.incomplete_pairs).toEqual([])
      expect(JSON.stringify(request.input)).not.toContain('不能送出的其他原文')
      expect(JSON.stringify(request.input)).not.toContain('其他秘密')
      expect(JSON.stringify(request.input)).not.toContain('https://example.org/a')
      expect(request.request_bytes).toBeLessThanOrEqual(GEMMA_MAX_REQUEST_BYTES)
    }
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

  it('立場可跨素材及同素材多段分群，重疊與未採用原因完整可查', async () => {
    const e4 = anchored('e4', 25, sources[0].content, '其他秘密。')
    const extended = [...evidence, e4]
    const extendedInput: GenerationInput = {
      ...input, evidence: extended,
      comparison: analyzeComparisons(extended, [
        judgment('e1', 'e2', 'agree'), judgment('e4', 'e2', 'agree'),
        judgment('e1', 'e3', 'disagree'), judgment('e2', 'e3', 'uncertain'),
      ]),
    }
    const output = positionsOutput()
    output.items[0].evidence_ids.push('e4')
    output.items[0].opinions[0].description[0].evidence_ids.push('e4')
    output.items.push({
      group_id: 'g2', evidence_ids: ['e1'], name: [cited('另一個明示面向', 'e1')], Core_concern: null,
      opinions: [{ Title: [cited('面向', 'e1')], description: [cited('來源主張。', 'e1')] }],
    })
    const result = await parseGemmaResponse('positions', completion(output), extendedInput)
    expect(result.data.items).toHaveLength(2)
    expect(result.data.items[0]).toMatchObject({ Sources: [
      { Title: '來源25', href: 'https://example.org/a', material_id: 25 },
      { Title: '來源26', href: '/issues/13/source/26', material_id: 26 },
    ] })
    expect(result.diagnostics).toMatchObject({ coverage: [
      { evidence_id: 'e1', group_ids: ['g1', 'g2'], status: 'overlapping', reason: null },
      { evidence_id: 'e2', group_ids: ['g1'], status: 'grouped' },
      { evidence_id: 'e3', group_ids: [], status: 'excluded', reason: '不足以納入此群' },
      { evidence_id: 'e4', group_ids: ['g1'], status: 'grouped' },
    ] })
    const phantom = structuredClone(output)
    phantom.items[0].opinions[0].description[0].evidence_ids = ['e1', 'e2']
    await expect(parseGemmaResponse('positions', completion(phantom), extendedInput)).rejects.toThrow('generation_insufficient_group_citations')
    const missing = structuredClone(output)
    missing.exclusions = []
    await expect(parseGemmaResponse('positions', completion(missing), extendedInput)).rejects.toThrow('generation_incomplete_coverage')
    const doubleClaim = structuredClone(output)
    doubleClaim.exclusions.push({ evidence_id: 'e1', reason: '已分群仍排除' })
    await expect(parseGemmaResponse('positions', completion(doubleClaim), extendedInput)).rejects.toThrow('generation_incomplete_coverage')
  })

  it('拒絕未知證據、跨群引用、直接相反分群和模型自行提供 Sources', async () => {
    const unknown = positionsOutput()
    unknown.items[0].name[0].evidence_ids = ['unknown']
    await expect(parseGemmaResponse('positions', completion(unknown), input)).rejects.toThrow('generation_unknown_evidence')
    const crossed = positionsOutput()
    crossed.items[0].name[0].evidence_ids = ['e3']
    await expect(parseGemmaResponse('positions', completion(crossed), input)).rejects.toThrow('generation_cross_candidate_citation')
    const conflicting = positionsOutput()
    conflicting.items[0].evidence_ids.push('e3')
    conflicting.exclusions = []
    await expect(parseGemmaResponse('positions', completion(conflicting), input)).rejects.toThrow('generation_contradictory_group')
    const invented = positionsOutput()
    Object.assign(invented.items[0], { Sources: [{ href: 'https://invented.invalid/' }] })
    await expect(parseGemmaResponse('positions', completion(invented), input)).rejects.toThrow('generation_invalid_schema')
    const noCitation = positionsOutput()
    noCitation.items[0].name[0].evidence_ids = []
    await expect(parseGemmaResponse('positions', completion(noCitation), input)).rejects.toThrow('generation_invalid_schema')
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

  it('三段各自拒絕截斷、拒答、工具呼叫及非原始 JSON', async () => {
    const fixtures: Record<GenerationSection, unknown> = { consensus: consensusOutput(), disputes: disputeOutput(), positions: positionsOutput() }
    for (const section of ['consensus', 'disputes', 'positions'] as const) {
      const native = completion(fixtures[section])
      const message: Record<string, unknown> = native.choices[0].message
      delete message.refusal
      expect((await parseGemmaResponse(section, native, input)).citation_map.length).toBeGreaterThan(0)
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
      const fenced = completion(fixtures[section])
      fenced.choices[0].message.content = '```json\n{}\n```'
      await expect(parseGemmaResponse(section, fenced, input)).rejects.toThrow('generation_invalid_json')
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
})
