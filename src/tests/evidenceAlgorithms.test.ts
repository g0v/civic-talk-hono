import { describe, expect, it } from 'vite-plus/test'
import { expandSentence, expandSentenceCandidate, extractClairicEvidence, sliceEvidenceSpan, type Evidence, type OffsetUnit } from '../ai/evidence'
import { analyzeComparisons, createEvidencePairs, pairKey, type DirectComparison, type Relation } from '../ai/comparison'
import { buildClefBatches, MODEL_VERSIONS, parseClefResponse } from '../ai/models'

function unitsBefore(text: string, utf16: number, unit: OffsetUnit): number {
  const prefix = text.slice(0, utf16)
  return unit === 'utf16' ? utf16 : unit === 'unicode' ? Array.from(prefix).length : new TextEncoder().encode(prefix).length
}

function offsets(text: string, quote: string, unit: OffsetUnit, from = 0): [number, number] {
  const start = text.indexOf(quote, from)
  if (start < 0) throw new Error('invalid test fixture')
  return [unitsBefore(text, start, unit), unitsBefore(text, start + quote.length, unit)]
}

function clairic(values: unknown, spans?: unknown, stateText?: unknown): unknown {
  return {
    model: 'clairic',
    truncated: false,
    answers: { claims: { type: 'list', value: values, ...(spans === undefined ? {} : { spans }) } },
    ...(stateText === undefined ? {} : { state_text: stateText }),
  }
}

function extract(content: string, values: unknown, spans?: unknown) {
  return extractClairicEvidence({ material_id: 1, content, state: content, response: clairic(values, spans) })
}

function evidence(id: string, materialId: number): Evidence {
  return { id, material_id: materialId, raw_quote: id, quote: id, raw_span: { start: 0, end: id.length, unit: 'utf16' }, expanded_span: { start: 0, end: id.length, unit: 'utf16' } }
}

function direct(a: Evidence, b: Evidence, relation: Relation, options: Partial<DirectComparison> = {}): DirectComparison {
  return {
    pair_key: pairKey(a.id, b.id),
    evidence_ids: [a.id, b.id],
    relation,
    question_version: 'q1',
    probabilities: { agree: 0.25, disagree: 0.25, unrelated: 0.25, uncertain: 0.25 },
    provider_diagnostics: { model: 'clef' },
    ...options,
  }
}

describe('Clairic 證據來源定位', () => {
  it.each(['utf16', 'unicode', 'utf8'] as const)('由原文與 span 唯一驗證 %s 單位，並核對原始與擴展引文', unit => {
    const content = '前😀主張具有條件。'
    const result = extract(content, ['主張'], [offsets(content, '主張', unit)])
    expect(result.status).toBe('complete')
    expect(result.evidence).toHaveLength(1)
    const item = result.evidence[0]
    expect(item.provider_span?.unit).toBe(unit)
    expect(item.provider_span?.possible_units).toEqual([unit])
    expect(item.raw_span.unit).toBe(unit)
    expect(sliceEvidenceSpan(content, item.raw_span)).toBe('主張')
    expect(sliceEvidenceSpan(content, item.expanded_span)).toBe('前😀主張具有條件。')
    expect(item.quote).toBe('前😀主張具有條件。')
    expect(item.raw_quote).toBe('主張')
    expect(result.state_mapping?.provider_state_text).toBeNull()
  })

  it('ASCII 無法區分單位時記錄可能值，不宣稱 provider 使用 UTF-16', () => {
    const result = extract('First claim.', ['claim'], [[6, 11]])
    expect(result.evidence[0].provider_span).toEqual({ start: 6, end: 11, unit: null, possible_units: ['utf16', 'unicode', 'utf8'] })
    expect(result.evidence[0].raw_span).toEqual({ start: 6, end: 11, unit: 'utf16' })
  })

  it('保留 provider 真正回傳 state_text 與包裝映射；每種 span 都回查素材而非包裝', () => {
    const content = '資源應有效分配。'
    const prefix = '說明😀\r\n'
    const state = `${prefix}${content}\r\nend`
    const result = extractClairicEvidence({ material_id: 4, content, state, source_start: prefix.length, response: clairic(['有效分配'], [offsets(state, '有效分配', 'utf8')], state) })
    expect(result.state_mapping).toEqual({ source_start_utf16: prefix.length, source_end_utf16: prefix.length + content.length, provider_state_text: state })
    expect(result.evidence[0].provider_span?.unit).toBe('utf8')
    expect(sliceEvidenceSpan(content, result.evidence[0].raw_span)).toBe('有效分配')
    expect(result.evidence[0].quote).toBe(content)
  })

  it('拒絕 provider 改寫／截斷 state、模型截斷與無效包裝映射', () => {
    const content = '甲\r\n乙。'
    expect(extractClairicEvidence({ material_id: 1, content, state: content, response: clairic(['乙'], undefined, '甲\n乙。') }).rejected[0].reason).toBe('state_text_mismatch')
    expect(extractClairicEvidence({ material_id: 1, content, state: content, response: { truncated: true, answers: {} } }).rejected[0].reason).toBe('truncated')
    expect(extractClairicEvidence({ material_id: 1, content, state: `x${content}`, response: clairic(['乙']) }).rejected[0].reason).toBe('invalid_state_mapping')
    expect(extractClairicEvidence({ material_id: 1, content, state: `x${content}`, source_start: 0, response: clairic(['乙']) }).rejected[0].reason).toBe('invalid_state_mapping')
  })

  it('保留中英日、emoji、CRLF 的原文，跨句主張不裁切', () => {
    const content = '第一句😀。\r\nSecond sentence! 日本語です。 End.'
    const result = extract(content, ['第一句', 'sentence', '日本語'])
    expect(result.evidence.map(item => item.quote)).toEqual(['第一句😀。', 'Second sentence!', '日本語です。'])
    const long = '第一句😀。\r\nSecond sentence'
    const crossSentence = extract(content, [long])
    expect(crossSentence.evidence[0].raw_quote).toBe(long)
    expect(crossSentence.evidence[0].quote).toBe('第一句😀。\r\nSecond sentence!')
    expect(sliceEvidenceSpan(content, crossSentence.evidence[0].raw_span)).toBe(long)
  })

  it('單一核心主張可保留多段條件、反例與少數觀點，不因超過三段裁切', () => {
    const sentences = ['市府主張應增加偏遠地區公車。', '此主張僅在已有合格司機時適用。', '經費必須先取得議會核准。', '反對者認為現行試辦的載客量不足。', '少數居民仍要求保留低使用量路線。']
    const content = sentences.join('\r\n')
    const values = ['增加偏遠地區公車', '已有合格司機', '議會核准', '載客量不足', '保留低使用量路線']
    const result = extract(
      content,
      values,
      values.map(value => offsets(content, value, 'utf16'))
    )
    expect(result.evidence.map(item => item.quote)).toEqual(sentences)
    for (const [index, item] of result.evidence.entries()) {
      expect(sliceEvidenceSpan(content, item.raw_span)).toBe(values[index])
      expect(sliceEvidenceSpan(content, item.expanded_span)).toBe(sentences[index])
    }
    expect(result.rejected).toEqual([])
    const stitched = extract(content, [`${sentences[0]}${sentences[4]}`])
    expect(stitched.evidence).toEqual([])
    expect(stitched.rejected).toEqual([{ index: 0, reason: 'not_found' }])
  })

  it('句尾引號與數值小數點不被誤當下一句', () => {
    const content = 'The rate is 3.14%. 「這是句子。」Next sentence!'
    const result = extract(content, ['3.14', '這是句子', 'Next'])
    expect(result.evidence.map(item => item.quote)).toEqual(['The rate is 3.14%.', '「這是句子。」', 'Next sentence!'])
    const fullQuote = content.indexOf('「')
    const expanded = expandSentence(content, fullQuote, content.indexOf('Next'))
    expect(content.slice(expanded.start, expanded.end)).toBe('「這是句子。」')
  })

  it('保留原文或新段落開頭的引號與說話者歸屬，前一句閉合引號不併入下一句', () => {
    const quoted = '"We support it."'
    expect(extract(quoted, ['We support it']).evidence[0].quote).toBe(quoted)
    const attributed = "'We support it,' she said."
    expect(extract(attributed, ['We support it']).evidence[0].quote).toBe(attributed)
    const afterNewline = '前段。\r\n"We support it."'
    expect(extract(afterNewline, ['We support it']).evidence[0].quote).toBe('"We support it."')
    const chinese = '「應支持此案。」下一句。'
    expect(extract(chinese, ['應支持此案', '下一句']).evidence.map(item => item.quote)).toEqual(['「應支持此案。」', '下一句。'])
  })

  it('缺 span 的唯一字串可定位；重複或重疊出現不得任選第一處', () => {
    expect(extract('唯一主張。', ['主張']).evidence[0].raw_quote).toBe('主張')
    expect(extract('重複。重複。', ['重複']).rejected[0].reason).toBe('ambiguous_value')
    expect(extract('哈哈哈。', ['哈哈']).rejected[0].reason).toBe('ambiguous_value')
  })

  it('有效 span 可定位重複片語的指定位置，衝突或不同單位對應不同位置必須拒絕', () => {
    const content = '重複。再次重複。'
    const second = content.lastIndexOf('重複')
    const result = extract(content, ['重複'], [offsets(content, '重複', 'utf16', second)])
    expect(result.evidence[0].quote).toBe('再次重複。')
    expect(result.evidence[0].raw_span.start).toBe(second)
    expect(extract('😀AA。', ['A'], [[2, 3]]).rejected[0].reason).toBe('ambiguous_span')
    expect(extract('甲乙丙。', ['甲'], [[1, 2]]).rejected[0].reason).toBe('span_value_conflict')
  })

  it('不以其他素材、包裝文字、guess、p_null 或失敗 span 補造出處', () => {
    const content = '僅有甲。'
    expect(extract(content, ['僅有乙']).rejected[0].reason).toBe('not_found')
    const state = '外部主張\n僅有甲。'
    const outside = extractClairicEvidence({ material_id: 1, content, state, source_start: 5, response: clairic(['外部主張'], [offsets(state, '外部主張', 'utf16')]) })
    expect(outside.evidence).toEqual([])
    expect(outside.rejected[0].reason).toBe('outside_source')
    const duplicatedState = `甲\n${content}`
    const duplicatedWrapper = extractClairicEvidence({ material_id: 1, content, state: duplicatedState, source_start: 2, response: clairic(['甲']) })
    expect(duplicatedWrapper.rejected[0].reason).toBe('ambiguous_value')
    const outsideWithoutSpan = extractClairicEvidence({ material_id: 1, content, state, source_start: 5, response: clairic(['外部主張']) })
    expect(outsideWithoutSpan.rejected[0].reason).toBe('outside_source')
    const nullResult = extractClairicEvidence({
      material_id: 1,
      content,
      state: content,
      response: { truncated: false, answers: { claims: { type: 'list', value: null, guess: ['甲'], p_null: 0.01 } } },
    })
    expect(nullResult).toMatchObject({ status: 'complete', evidence: [], rejected: [] })
    expect(extract(content, ['甲'], [[999, 1000]]).rejected[0].reason).toBe('span_value_conflict')
  })

  it.each(['utf16', 'unicode', 'utf8'] as const)('數量不一致時以精確 %s 座標保留同片語的不同位置', unit => {
    const content = '前😀。重複。中😀。不同。再重複。'
    const spans = [
      offsets(content, '重複', unit),
      offsets(content, '不同', unit),
      offsets(content, '重複', unit, content.lastIndexOf('重複')),
    ]
    const result = extract(content, ['重複', '不同'], spans)
    expect(result.status).toBe('complete')
    expect(result.rejected).toEqual([])
    expect(result.evidence.map(item => item.quote)).toEqual(['重複。', '不同。', '再重複。'])
    expect(result.evidence.map(item => item.raw_span)).toEqual([
      { start: spans[0][0], end: spans[0][1], unit },
      { start: spans[1][0], end: spans[1][1], unit },
      { start: spans[2][0], end: spans[2][1], unit },
    ])
    expect(result.evidence.map(item => sliceEvidenceSpan(content, item.raw_span))).toEqual(['重複', '不同', '重複'])
    expect(result.evidence.map(item => item.provider_span?.unit)).toEqual([unit, unit, unit])
  })

  it('重複的 value 可由較少但完整的精確座標覆蓋，不要求重複引文', () => {
    const result = extract('甲。', ['甲', '甲'], [[0, 1]])
    expect(result.status).toBe('complete')
    expect(result.evidence.map(item => item.raw_quote)).toEqual(['甲'])
    expect(result.evidence[0].raw_span).toEqual({ start: 0, end: 1, unit: 'utf16' })
    expect(result.evidence[0].provider_span?.possible_units).toEqual(['utf16', 'unicode'])
  })

  it.each([
    { name: '缺少某個 value', spans: [[0, 1], [4, 5], [0, 1]], reason: 'invalid_spans' },
    { name: '座標未匹配任何 value', spans: [[0, 1], [2, 3], [1, 2]], reason: 'span_value_conflict' },
    { name: '座標超出原文', spans: [[0, 1], [2, 3], [999, 1000]], reason: 'span_value_conflict' },
    { name: 'null 座標', spans: [[0, 1], [2, 3], null], reason: 'invalid_spans' },
    { name: '格式錯誤座標', spans: [[0, 1], [2, 3], [4]], reason: 'invalid_spans' },
    { name: '完全沒有座標', spans: [], reason: 'invalid_spans' },
  ])('數量不一致且$name時整份拒收，不交付先前已配對的證據', ({ spans, reason }) => {
    const result = extract('甲。乙。甲。', ['甲', '乙'], spans)
    expect(result.status).toBe('failed')
    expect(result.evidence).toEqual([])
    expect(result.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ reason })]))
  })

  it.each([
    { content: '😀AA。', values: ['A'], spans: [[3, 4], [2, 3]] },
    { content: '😀AB。', values: ['A', 'B'], spans: [[2, 3]] },
  ])('數量不一致且不同座標單位指向不同位置時拒收，無論是否為相同文字', ({ content, values, spans }) => {
    const result = extract(content, values, spans)
    expect(result.status).toBe('failed')
    expect(result.evidence).toEqual([])
    expect(result.rejected).toContainEqual(expect.objectContaining({ reason: 'ambiguous_span' }))
  })

  it('數量不一致時不接受素材外的相同文字，也不丟掉壞座標繼續交付', () => {
    const content = '甲。'
    const state = `甲\n${content}`
    const result = extractClairicEvidence({
      material_id: 1,
      content,
      state,
      source_start: 2,
      response: clairic(['甲'], [[2, 3], [0, 1]], state),
    })
    expect(result.status).toBe('failed')
    expect(result.evidence).toEqual([])
    expect(result.rejected).toEqual([{ index: 1, reason: 'outside_source' }])
    expect(result.state_mapping?.provider_state_text).toBe(state)
  })

  it('數量不一致仍拒絕空字串 value，不能只保留有效片段', () => {
    const result = extract('甲。', ['甲', ''], [[0, 1]])
    expect(result.status).toBe('failed')
    expect(result.evidence).toEqual([])
    expect(result.rejected).toEqual([{ index: null, reason: 'invalid_value' }])
  })

  it('數量一致的錯位座標仍依原索引拒收，不進入重新配對', () => {
    const result = extract('甲。乙。', ['甲', '乙'], [[2, 3], [0, 1]])
    expect(result.status).toBe('failed')
    expect(result.evidence).toEqual([])
    expect(result.rejected).toEqual([{ index: 0, reason: 'span_value_conflict' }, { index: 1, reason: 'span_value_conflict' }])
  })

  it('拒絕缺漏或格式錯誤的 spans，不將壞 span 降級為字串搜尋', () => {
    expect(extract('第一第二。', ['第一', '第二'], [[0, 2]]).rejected[0].reason).toBe('invalid_spans')
    expect(extract('第一。', ['第一'], [[0]]).rejected[0].reason).toBe('invalid_spans')
    expect(extract('第一。', ['第一'], ['0,2']).rejected[0].reason).toBe('invalid_spans')
    expect(extract('第一。', ['第一'], [null]).evidence).toHaveLength(1)
    expect(extract('😀A。', ['\ud83d']).rejected[0].reason).toBe('invalid_value')
  })

  it('完整選取的歸屬、反對理由與跨句條件不被展句換成前後其他人的主張', () => {
    const selected = '乙方反對增班，擔心人力不足。若無合格司機，排班將難以維持。'
    const content = `甲方要求增加班次。${selected}丙方建議先調降票價。`
    const result = extract(content, [selected])
    expect(result.status).toBe('complete')
    expect(result.evidence[0].raw_quote).toBe(selected)
    expect(result.evidence[0].quote).toBe(selected)
    expect(sliceEvidenceSpan(content, result.evidence[0].raw_span)).toBe(selected)
    expect(sliceEvidenceSpan(content, result.evidence[0].expanded_span)).toBe(selected)
  })

  it('同一完整原文單位的詞級錨點去重，不放大成多個主張，無效定位仍保留 partial 診斷', () => {
    const result = extract('此主張需要支持。另一句。', ['主張', '支持', '主張', '不存在'])
    expect(result.status).toBe('partial')
    expect(result.evidence.map(item => item.raw_quote)).toEqual(['主張'])
    expect(result.evidence.map(item => item.quote)).toEqual(['此主張需要支持。'])
    expect(result.duplicates).toBe(2)
    expect(result.rejected).toEqual([{ index: 3, reason: 'not_found' }])
    const other = extractClairicEvidence({ material_id: 2, content: '此主張需要支持。', state: '此主張需要支持。', response: clairic(['主張']) })
    expect(other.evidence[0].id).not.toBe(result.evidence[0].id)
  })
})

describe('離線句界候選', () => {
  it.each([
    { content: 'The U.S. opposes it.', raw: 'opposes', expected: 'The U.S. opposes it.' },
    { content: 'Before. The U.K. supports it. After.', raw: 'supports', expected: 'The U.K. supports it.' },
    { content: 'The U.N. and U.S.A. agree.', raw: 'U.N.', expected: 'The U.N. and U.S.A. agree.' },
    { content: '甲。"乙。"', raw: '甲', expected: '甲。' },
    { content: '甲。"乙。"', raw: '乙', expected: '"乙。"' },
    { content: "甲。'乙。'", raw: '甲', expected: '甲。' },
    { content: "甲。'乙。'", raw: '乙', expected: "'乙。'" },
    { content: '"甲。""乙。"', raw: '甲', expected: '"甲。"' },
    { content: '"甲。""乙。"', raw: '乙', expected: '"乙。"' },
    { content: '甲！?"乙？!"丙。', raw: '甲', expected: '甲！?' },
    { content: '甲！?"乙？!"丙。', raw: '乙', expected: '"乙？!"' },
    { content: '甲。("乙！")丙。', raw: '乙', expected: '("乙！")' },
    { content: '「甲。」"乙。"', raw: '甲', expected: '「甲。」' },
    { content: '「甲。」"乙。"', raw: '乙', expected: '"乙。"' },
    { content: '"甲『乙！』"丙。', raw: '乙', expected: '"甲『乙！』"' },
    { content: '"She said \'Go!\'" Next.', raw: 'Go', expected: '"She said \'Go!\'"' },
    { content: '"We support it." Next.', raw: 'We support', expected: '"We support it."' },
    { content: '"We support it." Next.', raw: '"We support it."', expected: '"We support it."' },
    { content: "'We support it,' she said. Next.", raw: 'support', expected: "'We support it,' she said." },
    { content: '甲。\r\n"We support it."', raw: 'support', expected: '"We support it."' },
    { content: "Don't cut the claim. Next.", raw: 'claim', expected: "Don't cut the claim." },
    { content: '"Don\'t cut it." Next.', raw: 'cut', expected: '"Don\'t cut it."' },
    { content: "The residents' plan works. 'Next.'", raw: 'works', expected: "The residents' plan works." },
    { content: 'The rate is 3.14%. Next.', raw: '3.14', expected: 'The rate is 3.14%.' },
    { content: '前😀。\r\n \t第二句😀！\r\n後句。', raw: '第二句😀', expected: '第二句😀！' },
    { content: '前😀。重複。再次重複😀。', raw: '重複', from: 7, expected: '再次重複😀。' },
    { content: '第一句😀。\r\nSecond sentence! 日本語です。', raw: '第一句😀。\r\nSecond sentence', expected: '第一句😀。\r\nSecond sentence!' },
    { content: '甲方要求增班。乙方反對增班。若無司機，排班難以維持。丙方提議降價。', raw: '乙方反對增班。若無司機，排班難以維持。', expected: '乙方反對增班。若無司機，排班難以維持。' },
    { content: '只有不排擠預算時，協會才支持補助。下一句。', raw: '支持', expected: '只有不排擠預算時，協會才支持補助。' },
    { content: '協會支持補助。\r\n但前提是先評估經費。後文。', raw: '支持補助。\r\n但前提是先評估經費', expected: '協會支持補助。\r\n但前提是先評估經費。' },
    { content: '「應停建。」是反對者的主張。下一句。', raw: '應停建', expected: '「應停建。」是反對者的主張。' },
    { content: '「應停建。」是反對者的主張。下一句。', raw: '反對者', expected: '「應停建。」是反對者的主張。' },
    { content: '"應停建。"為反對者的立場。後文。', raw: '應停建', expected: '"應停建。"為反對者的立場。' },
    { content: '「不應停建。應先評估。」是協會的看法。後文。', raw: '不應停建', expected: '「不應停建。應先評估。」是協會的看法。' },
    { content: '「不應停建。應先評估。」是協會的看法。後文。', raw: '應先評估', expected: '「不應停建。應先評估。」是協會的看法。' },
    { content: '「他說『應停建。』」是協會的說法。後文。', raw: '應停建', expected: '「他說『應停建。』」是協會的說法。' },
    { content: '「應停建。」\r\n是反對者的主張。後文。', raw: '反對者', expected: '「應停建。」\r\n是反對者的主張。' },
    { content: '「應停建。」下一句談交通。', raw: '應停建', expected: '「應停建。」' },
    { content: '前文。這是協會的主張。', raw: '協會', expected: '這是協會的主張。' },
    { content: '協會支持補助。\n但前提是先完成經費評估。後文。', raw: '支持補助', expected: '協會支持補助。\n但前提是先完成經費評估。' },
    { content: '協會支持補助。\n但前提是先完成經費評估。後文。', raw: '經費評估', expected: '協會支持補助。\n但前提是先完成經費評估。' },
    { content: '前文😀。\r\n協會支持補助。\r\n \t但前提是不得排擠教育經費。後文。', raw: '支持', expected: '協會支持補助。\r\n \t但前提是不得排擠教育經費。' },
    { content: '協會支持補助。但前提是先評估經費。條件是不得排擠教育。後文。', raw: '教育', expected: '協會支持補助。但前提是先評估經費。條件是不得排擠教育。' },
    { content: '「應補助。」是協會的主張。\n但前提是先評估經費。後文。', raw: '經費', expected: '「應補助。」是協會的主張。\n但前提是先評估經費。' },
    { content: '協會支持補助。\n\n但前提是另一案通過。', raw: '支持', expected: '協會支持補助。' },
    { content: '協會支持補助。\n\n但前提是另一案通過。', raw: '另一案', expected: '但前提是另一案通過。' },
    { content: '協會支持補助。\n但市府反對增稅。', raw: '支持', expected: '協會支持補助。' },
    { content: '前文。只有不排擠預算時，協會才支持補助。', raw: '支持', expected: '只有不排擠預算時，協會才支持補助。' },
    { content: '協會支持補助。\n\n但前提是另一案通過。', raw: '支持補助。\n', expected: '協會支持補助。\n' },
    { content: '協會支持補助。\n但前提是先完成經費評估。後文。', raw: '\n但前提是先完成經費評估', expected: '協會支持補助。\n但前提是先完成經費評估。' },
    { content: '「應停建。」是另一回事. 交通改善是市府的主張。後文。', raw: '應停建', expected: '「應停建。」' },
    { content: '「應停建。」是另一回事. 交通改善是市府的主張。後文。', raw: '交通改善', expected: '交通改善是市府的主張。' },
    { content: '「應停建。\n\n交通費應調降。」是協會的主張。後文。', raw: '應停建', expected: '「應停建。' },
    { content: '「應停建。\r\n \t\r\n交通費應調降。」是協會的主張。後文。', raw: '應停建', expected: '「應停建。' },
    { content: '「應停建。\r\n交通費應調降。」是協會的主張。後文。', raw: '應停建', expected: '「應停建。\r\n交通費應調降。」是協會的主張。' },
    { content: '「應停建。\n\n交通費應調降。」是協會的主張。後文。', raw: '「應停建。\n\n交通費應調降。」', expected: '「應停建。\n\n交通費應調降。」是協會的主張。' },
    { content: '「應停建。」是U.S.協會的主張。後文。', raw: '應停建', expected: '「應停建。」是U.S.協會的主張。' },
    { content: '「協會支持補助。\n但前提是先評估經費。」是反對者的說法。後文。', raw: '支持', expected: '「協會支持補助。\n但前提是先評估經費。」是反對者的說法。' },
    { content: '甲方支持弱勢補助；乙方反對普遍補助，除非政府證明不排擠教育預算。', raw: '支持弱勢補助', expected: '甲方支持弱勢補助' },
    { content: '甲方支持弱勢補助；乙方反對普遍補助，除非政府證明不排擠教育預算。', raw: '反對普遍補助', expected: '乙方反對普遍補助，除非政府證明不排擠教育預算。' },
    { content: '甲方支持弱勢補助；乙方反對普遍補助，除非政府證明不排擠教育預算。', raw: '不排擠教育預算', expected: '乙方反對普遍補助，除非政府證明不排擠教育預算。' },
    { content: '家長協會支持弱勢補助 ;  市府反對普遍補助。', raw: '支持', expected: '家長協會支持弱勢補助' },
    { content: '家長協會支持弱勢補助 ;  市府反對普遍補助。', raw: '反對', expected: '市府反對普遍補助。' },
    { content: '協會支持弱勢補助；市府不反對普遍補助。', raw: '反對', expected: '市府不反對普遍補助。' },
    { content: '協會支持弱勢補助；反對普遍補助，除非先評估。', raw: '反對', expected: '協會支持弱勢補助；反對普遍補助，除非先評估。' },
    { content: '甲方支持弱勢補助；但反對普遍補助。', raw: '反對', expected: '甲方支持弱勢補助；但反對普遍補助。' },
    { content: '甲方支持弱勢補助；除非乙方反對普遍補助。', raw: '支持', expected: '甲方支持弱勢補助；除非乙方反對普遍補助。' },
    { content: '「甲方支持弱勢補助；乙方反對普遍補助。」是協會的說法。', raw: '反對', expected: '「甲方支持弱勢補助；乙方反對普遍補助。」是協會的說法。' },
    { content: '討論（甲方支持弱勢補助；乙方反對普遍補助）。', raw: '反對', expected: '討論（甲方支持弱勢補助；乙方反對普遍補助）。' },
    { content: '甲方支持弱勢補助；乙方反對普遍補助，除非政府證明不排擠教育預算。', raw: '支持弱勢補助；乙方反對普遍補助', expected: '甲方支持弱勢補助；乙方反對普遍補助，除非政府證明不排擠教育預算。' },
    { content: '甲方支持弱勢😀補助；乙方反對普遍補助；丙方支持偏遠地區補助。', raw: '反對', expected: '乙方反對普遍補助' },
    { content: '只有經費足夠時，協會才支持補助；市府反對增稅。', raw: '反對', expected: '只有經費足夠時，協會才支持補助；市府反對增稅。' },
    { content: '甲方支持補助；乙方反對增稅。\n但前提是先評估經費。', raw: '反對', expected: '甲方支持補助；乙方反對增稅。\n但前提是先評估經費。' },
    { content: '甲方支持補助; 乙方反對增稅。', raw: ' 乙方反對增稅', expected: ' 乙方反對增稅。' },
    { content: 'A supports the plan; B opposes the plan.', raw: 'opposes', expected: 'A supports the plan; B opposes the plan.' },
    { content: '甲方支持弱勢補助；乙方反對。', raw: '反對', expected: '甲方支持弱勢補助；乙方反對。' },
    { content: '甲方支持弱勢補助；乙方反對該補助。', raw: '反對', expected: '甲方支持弱勢補助；乙方反對該補助。' },
    { content: '甲方支持弱勢補助；乙方反對，因為經費不足。', raw: '反對', expected: '甲方支持弱勢補助；乙方反對，因為經費不足。' },
    { content: '甲方支持弱勢補助；假設乙方反對普遍補助。', raw: '支持', expected: '甲方支持弱勢補助；假設乙方反對普遍補助。' },
    { content: '甲方支持弱勢補助；乙方反對增稅是必要前提。', raw: '支持', expected: '甲方支持弱勢補助；乙方反對增稅是必要前提。' },
    { content: '甲方支持弱勢補助的條件是；乙方反對增稅。', raw: '反對', expected: '甲方支持弱勢補助的條件是；乙方反對增稅。' },
    { content: '甲方支持弱勢補助；乙方若支持普遍補助。', raw: '支持弱勢補助', expected: '甲方支持弱勢補助；乙方若支持普遍補助。' },
    { content: '甲方支持弱勢補助；乙方只有反對增稅才同意。', raw: '反對', expected: '甲方支持弱勢補助；乙方只有反對增稅才同意。' },
    { content: '甲方支持弱勢補助；同時反對普遍補助。', raw: '反對', expected: '甲方支持弱勢補助；同時反對普遍補助。' },
    { content: '甲方支持弱勢補助；另外反對普遍補助。', raw: '反對', expected: '甲方支持弱勢補助；另外反對普遍補助。' },
    { content: '甲方支持弱勢補助；比方反對普遍補助。', raw: '反對', expected: '甲方支持弱勢補助；比方反對普遍補助。' },
    { content: '甲方支持弱勢補助；乙方反對前者。', raw: '反對', expected: '甲方支持弱勢補助；乙方反對前者。' },
    { content: '甲方支持弱勢補助；乙方反對上述補助。', raw: '反對', expected: '甲方支持弱勢補助；乙方反對上述補助。' },
    { content: '甲方支持弱勢補助；乙方反對前者；丙方支持交通補助。', raw: '反對', expected: '甲方支持弱勢補助；乙方反對前者；丙方支持交通補助。' },
    { content: '甲方支持弱勢補助；上述協會反對普遍補助。', raw: '反對', expected: '甲方支持弱勢補助；上述協會反對普遍補助。' },
    { content: '張三支持弱勢補助；李四反對普遍補助。', raw: '反對', expected: '張三支持弱勢補助；李四反對普遍補助。' },
    { content: '地方政府支持弱勢補助；居民協會反對普遍補助。', raw: '反對', expected: '居民協會反對普遍補助。' },
  ])('保留原文句界與錨點：$content / $raw / $from', ({ content, raw, expected, from = 0 }) => {
    const [rawStart, rawEnd] = offsets(content, raw, 'utf16', from)
    const expectedStart = content.indexOf(expected, from)

    const span = expandSentenceCandidate(content, rawStart, rawEnd)

    expect(span).toEqual({ start: expectedStart, end: expectedStart + expected.length, unit: 'utf16' })
    expect(content.slice(span.start, span.end)).toBe(expected)
    expect(span.start).toBeLessThanOrEqual(rawStart)
    expect(span.end).toBeGreaterThanOrEqual(rawEnd)
  })
})

describe('Clef 無向配對與支持群', () => {
  const a = evidence('A', 1)
  const b = evidence('B', 2)
  const c = evidence('C', 3)

  it('交換配對得到相同 key，跨素材固定排序且保留實際題序與診斷', () => {
    const anotherA = evidence('A2', 1)
    const pairs = createEvidencePairs([c, b, anotherA, a])
    expect(pairKey('A', 'B')).toBe(pairKey('B', 'A'))
    expect(new Set(pairs.map(pair => pair.key)).size).toBe(pairs.length)
    expect(pairs).toEqual(createEvidencePairs([a, anotherA, b, c]))
    expect(pairs.some(pair => pair.key === pairKey('A', 'A2'))).toBe(false)
    const answer = direct(b, a, 'agree', { cached: true, provider_diagnostics: { request: 'r1' } })
    const result = analyzeComparisons([a, b], [answer])
    expect(result.direct_comparisons[0]).toMatchObject({ evidence_ids: ['B', 'A'], provider_diagnostics: { request: 'r1' } })
    expect(result.diagnostics).toMatchObject({ eligible_pairs: 1, direct_judgments: 1, cache_hits: 1 })
    expect(() => analyzeComparisons([a, b], [answer, direct(a, b, 'agree')])).toThrow('duplicate_direct_comparison')
  })

  it('保留完整引文、出處、平手機率與 provider 低信心，不因任意門檻改寫選項', () => {
    const left = { ...a, quote: '甲說：「逐字😀。\r\n不可忽略條件。」', raw_quote: '逐字😀。\r\n不可忽略條件。' }
    const right = { ...b, quote: '乙提出另一個主張。', raw_quote: '乙提出另一個主張。' }
    const batch = buildClefBatches([right, left], createEvidencePairs([left, right]))[0]
    expect(batch.input.state.evidence).toEqual([
      { id: 'A', material_id: 1, quote: left.quote },
      { id: 'B', material_id: 2, quote: right.quote },
    ])
    const probabilities = { agree: 0.25, disagree: 0.25, unrelated: 0.25, uncertain: 0.25 }
    const answer = { type: 'choice', choice: 'uncertain', probabilities, confidence: 0 }
    const [parsed] = parseClefResponse({ model: 'clef', answers: { q0: answer } }, batch)
    expect(parsed).toMatchObject({
      pair_key: pairKey('A', 'B'),
      evidence_ids: ['A', 'B'],
      relation: 'uncertain',
      question_version: MODEL_VERSIONS.clef_prompt,
      probabilities,
      provider_diagnostics: { confidence: 0, question_id: 'q0', truncated: null },
    })
    expect(analyzeComparisons([left, right], [parsed]).direct_comparisons[0]).toEqual(parsed)
    expect(() => parseClefResponse({ model: 'clef', answers: { q0: { ...answer, probabilities: { ...probabilities, agree: Number.NaN } } } }, batch)).toThrow('clef_invalid_probabilities')
  })

  it('pair key 對含特殊分隔符的 ID 仍無碰撞', () => {
    expect(pairKey('A,B', 'C')).not.toBe(pairKey('A', 'B,C'))
    expect(pairKey('x"', 'y')).toBe(pairKey('y', 'x"'))
  })

  it.each(['disagree', 'unrelated', 'uncertain'] as const)('支持鏈不覆蓋直接 %s，保留兩個較小支持群', relation => {
    const ac = direct(a, c, relation)
    const result = analyzeComparisons([a, b, c], [direct(a, b, 'agree'), direct(b, c, 'agree'), ac])
    expect(result.consensus_groups.map(group => group.evidence_ids)).toEqual([
      ['A', 'B'],
      ['B', 'C'],
    ])
    expect(result.candidate_paths).toMatchObject([{ pair_key: pairKey('A', 'C'), path: ['A', 'B', 'C'], status: relation, direct: ac, exclusion_reason: `direct_${relation}` }])
    expect(result.disputes).toHaveLength(relation === 'disagree' ? 1 : 0)
    expect(result.diagnostics).toMatchObject({ direct_judgments: 3, incomplete_pairs: 0, inferred_candidates: 1 })
  })

  it('缺漏和失敗不等於 agree；反向 agree 只作診斷不補寫正式邊', () => {
    const ab = direct(a, b, 'agree')
    const bc = direct(b, c, 'agree')
    const reverse = direct(c, a, 'agree')
    const missing = analyzeComparisons([a, b, c], [ab, bc], [], [reverse])
    expect(missing.consensus_groups.map(group => group.evidence_ids)).toEqual([
      ['A', 'B'],
      ['B', 'C'],
    ])
    expect(missing.candidate_paths).toMatchObject([{ status: 'pending', path: ['A', 'B', 'C'], direct: null }])
    expect(missing.incomplete_pairs).toMatchObject([{ pair_key: pairKey('A', 'C'), status: 'missing' }])
    expect(missing.reverse_diagnostics).toEqual([reverse])
    expect(missing.direct_comparisons).not.toContain(reverse)
    const failure = { pair_key: pairKey('A', 'C'), error_code: 'provider_failed' }
    const failed = analyzeComparisons([a, b, c], [ab, bc], [failure])
    expect(failed.candidate_paths).toMatchObject([{ status: 'failed', failure }])
    expect(failed.incomplete_pairs).toMatchObject([{ status: 'failed', failure }])
    expect(failed.diagnostics).toMatchObject({ direct_judgments: 2, incomplete_pairs: 1 })
  })

  it('反向診斷的 disagree 不會覆寫正式 agree，三邊確認後才成三來源支持群', () => {
    const judgments = [direct(a, b, 'agree'), direct(b, c, 'agree'), direct(a, c, 'agree')]
    const result = analyzeComparisons([c, a, b], judgments, [], [direct(c, a, 'disagree')])
    expect(result.consensus_groups).toMatchObject([{ evidence_ids: ['A', 'B', 'C'] }])
    expect(result.disputes).toEqual([])
    expect(result.candidate_paths).toEqual([])
  })

  it('同素材不形成支持票，所有跨素材配對都必須直接確認才能進群', () => {
    const a2 = evidence('A2', 1)
    const first = analyzeComparisons([a, a2, b], [direct(a, b, 'agree')])
    expect(first.consensus_groups.map(group => group.evidence_ids)).toEqual([['A', 'B']])
    expect(first.unclassified_evidence_ids).toEqual(['A2'])
    const complete = analyzeComparisons([a, a2, b], [direct(a, b, 'agree'), direct(a2, b, 'agree')])
    expect(complete.consensus_groups.map(group => group.evidence_ids)).toEqual([['A', 'A2', 'B']])
    expect(complete.diagnostics.eligible_pairs).toBe(2)
    expect(() => analyzeComparisons([a, a2], [direct(a, a2, 'agree')])).toThrow('invalid_direct_comparison')
  })

  it('拒絕未知、重複與失敗衝突記錄，防止假造正式關係', () => {
    const ab = direct(a, b, 'agree')
    expect(() => analyzeComparisons([a, b], [ab], [{ pair_key: ab.pair_key, error_code: 'failed' }])).toThrow('invalid_comparison_failure')
    expect(() => analyzeComparisons([a, b], [{ ...ab, evidence_ids: ['A', 'C'] }])).toThrow('invalid_direct_comparison')
    expect(() => analyzeComparisons([a, b], [{ ...ab, probabilities: { agree: 1.2, disagree: 0, unrelated: 0, uncertain: 0 } }])).toThrow('invalid_direct_probabilities')
    expect(() => analyzeComparisons([a, b], [{ ...ab, probabilities: null as unknown as DirectComparison['probabilities'] }])).toThrow('invalid_direct_probabilities')
    expect(() => analyzeComparisons([a, b], [{ ...ab, probabilities: { agree: 0.1, disagree: 0.7, unrelated: 0.1, uncertain: 0.1 } }])).toThrow('invalid_direct_probabilities')
    expect(() => createEvidencePairs([a, { ...b, id: 'A' }])).toThrow('invalid_evidence')
  })

  it('64 個證據的指數 clique 圖仍只建有界群，保留每個直接支持邊', () => {
    const all = Array.from({ length: 64 }, (_, i) => evidence(`E${String(i).padStart(2, '0')}`, i + 1))
    const pairs = createEvidencePairs(all)
    const lookup = new Map(all.map(item => [item.id, item]))
    // 每兩點一組互不支持，其餘皆支持；此圖有 2^32 個 maximal cliques。
    const judgments = pairs.map(pair => {
      const left = lookup.get(pair.a)!
      const right = lookup.get(pair.b)!
      const sameGroup = Math.floor((left.material_id - 1) / 2) === Math.floor((right.material_id - 1) / 2)
      return direct(left, right, sameGroup ? 'disagree' : 'agree')
    })
    const result = analyzeComparisons(all, judgments)
    expect(pairs).toHaveLength(2016)
    expect(result.diagnostics.direct_judgments).toBe(2016)
    expect(result.consensus_groups.length).toBeLessThanOrEqual(2016)
    for (const judgment of judgments.filter(item => item.relation === 'agree')) {
      expect(result.consensus_groups.some(group => judgment.evidence_ids.every(id => group.evidence_ids.includes(id)))).toBe(true)
    }
    for (const group of result.consensus_groups) {
      const ids = group.evidence_ids.map(id => lookup.get(id)!.material_id)
      expect(new Set(ids.map(id => Math.floor((id - 1) / 2))).size).toBe(ids.length)
    }
    expect(() => createEvidencePairs([...all, evidence('extra', 65)])).toThrow('too_many_evidence')
  })
})
