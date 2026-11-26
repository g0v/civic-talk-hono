import { expandSentence } from './evidenceBoundaries'
import { coordinates, toUtf16, fromUtf16, units } from './evidenceCoordinates'
import { expandSentenceCandidate } from './evidenceCandidateRanges'
import type { CandidatePassage } from './evidenceCandidates'

export { sliceEvidenceSpan } from './evidenceCoordinates'
export { expandSentence } from './evidenceBoundaries'

export const EVIDENCE_ALGORITHM_VERSION = 'evidence-2' as const
export const MAX_EVIDENCE = 64

export type OffsetUnit = 'utf16' | 'unicode' | 'utf8'
export interface Span<U extends OffsetUnit = OffsetUnit> {
  start: number
  end: number
  unit: U
}

export interface ProviderSpan {
  start: number
  end: number
  // 無法從此筆 value/span 區分時，保留所有可能單位，不假稱 provider 選用哪一種。
  unit: OffsetUnit | null
  possible_units: OffsetUnit[]
}

export interface Evidence {
  id: string
  material_id: number
  // quote 是按原文句界展開的判讀單位；raw_quote／raw_span 只保留 provider 定位錨點。
  quote: string
  raw_quote: string
  raw_span: Span
  expanded_span: Span<'utf16'>
  // 原始 offset 以送交 provider 的 state 為座標；raw_span 則以素材原文為座標。
  provider_span?: ProviderSpan | null
  context?: CandidatePassage<'context'>
}

export interface EvidenceRejection {
  index: number | null
  reason:
    | 'invalid_input'
    | 'invalid_state_mapping'
    | 'invalid_unicode'
    | 'invalid_response'
    | 'truncated'
    | 'state_text_mismatch'
    | 'invalid_answer'
    | 'invalid_spans'
    | 'invalid_value'
    | 'not_found'
    | 'ambiguous_value'
    | 'span_value_conflict'
    | 'ambiguous_span'
    | 'outside_source'
}

export interface EvidenceStateMapping {
  source_start_utf16: number
  source_end_utf16: number
  // 僅記錄 provider 真正回傳的 state_text；未回傳時不得用 request 填充。
  provider_state_text: string | null
}

export interface EvidenceExtraction {
  status: 'complete' | 'partial' | 'failed'
  evidence: Evidence[]
  rejected: EvidenceRejection[]
  duplicates: number
  state_mapping: EvidenceStateMapping | null
}

export interface ClairicEvidenceInput {
  material_id: number
  content: string
  state: string
  response: unknown
  field?: string
  // 若 state 包裝了素材，呼叫者必須提供原文在 state 中的 UTF-16 起點。
  source_start?: number
}

export { expandSentenceCandidate, expandEvidenceCandidateRanges } from './evidenceCandidateRanges'

export interface ValidatedRawAnchor {
  readonly index: number
  readonly span: Span<'utf16'>
  readonly raw_span: Span
  readonly provider_span: ProviderSpan | null
}

export interface ClaimAnchorExtraction extends EvidenceExtraction {
  readonly anchors: ValidatedRawAnchor[]
  readonly anchor_index_kind: 'value' | 'span'
}

function failed(reason: EvidenceRejection['reason']): ClaimAnchorExtraction {
  return { status: 'failed', evidence: [], rejected: [{ index: null, reason }], duplicates: 0, state_mapping: null, anchors: [], anchor_index_kind: 'value' }
}

/** 只接受唯一可回查該素材原文的 list value；不以 guess 或信心補造資料。 */
export function extractClairicEvidence(input: ClairicEvidenceInput): EvidenceExtraction {
  const result = extract(input, expandSentence)
  return { status: result.status, evidence: result.evidence, rejected: result.rejected, duplicates: result.duplicates, state_mapping: result.state_mapping }
}

/** 正式E1與舊E0共用同一驗證器；在展句去重前保留全部已接受錨點。 */
export function extractClairicClaimAnchors(input: ClairicEvidenceInput): ClaimAnchorExtraction {
  return extract(input, expandSentenceCandidate)
}

function extract(input: ClairicEvidenceInput, expand: typeof expandSentence): ClaimAnchorExtraction {
  const { material_id, content, state, response } = input
  if (!Number.isSafeInteger(material_id) || material_id <= 0 || typeof content !== 'string' || typeof state !== 'string' || !content.length) return failed('invalid_input')
  const sourceStart = input.source_start ?? (state === content ? 0 : -1)
  const sourceEnd = sourceStart + content.length
  if (!Number.isSafeInteger(sourceStart) || sourceStart < 0 || state.slice(sourceStart, sourceEnd) !== content) return failed('invalid_state_mapping')
  const map = coordinates(state)
  if (!map || toUtf16(state, map, sourceStart, 'utf16') === null || toUtf16(state, map, sourceEnd, 'utf16') === null) return failed('invalid_unicode')
  if (response === null || typeof response !== 'object' || Array.isArray(response)) return failed('invalid_response')
  const result = response as Record<string, unknown>
  if (typeof result.truncated !== 'boolean') return failed('invalid_response')
  if (result.truncated) return failed('truncated')
  if (result.state_text !== undefined && (typeof result.state_text !== 'string' || result.state_text !== state)) return failed('state_text_mismatch')
  const stateMapping: EvidenceStateMapping = {
    source_start_utf16: sourceStart,
    source_end_utf16: sourceEnd,
    provider_state_text: typeof result.state_text === 'string' ? result.state_text : null,
  }
  if (result.answers === null || typeof result.answers !== 'object' || Array.isArray(result.answers)) return { ...failed('invalid_answer'), state_mapping: stateMapping }
  const answers = result.answers as Record<string, unknown>
  const rawAnswer = answers[input.field ?? 'claims']
  if (rawAnswer === null || typeof rawAnswer !== 'object' || Array.isArray(rawAnswer)) return { ...failed('invalid_answer'), state_mapping: stateMapping }
  const answer = rawAnswer as Record<string, unknown>
  if (answer.type !== 'list' || !('value' in answer)) return { ...failed('invalid_answer'), state_mapping: stateMapping }
  if (answer.value === null) return { status: 'complete', evidence: [], rejected: [], duplicates: 0, state_mapping: stateMapping, anchors: [], anchor_index_kind: 'value' }
  if (!Array.isArray(answer.value)) return { ...failed('invalid_answer'), state_mapping: stateMapping }
  const values = answer.value
  // 不把壞 span 當成缺 span 退回搜尋；數量不一致時僅接受完整、精確且無歧義的重新配對。
  if (answer.spans !== undefined && !Array.isArray(answer.spans)) return { ...failed('invalid_spans'), state_mapping: stateMapping }
  const spans = answer.spans as unknown[] | undefined
  const matchedValues = spans && spans.length !== values.length ? new Map<string, boolean>() : null
  if (matchedValues) {
    for (const value of values) {
      if (typeof value !== 'string' || !value.length) return { ...failed('invalid_value'), state_mapping: stateMapping }
      matchedValues.set(value, false)
    }
  }
  const evidence: Evidence[] = []
  const anchors: ValidatedRawAnchor[] = []
  const rejected: EvidenceRejection[] = []
  const seen = new Set<string>()
  let duplicates = 0
  const reject = (index: number, reason: EvidenceRejection['reason']) => rejected.push({ index, reason })

  for (let index = 0; index < (matchedValues ? spans!.length : values.length); index++) {
    let value = ''
    if (!matchedValues) {
      const original: unknown = values[index]
      if (typeof original !== 'string' || !original.length) {
        reject(index, 'invalid_value')
        continue
      }
      value = original
    }
    let rawStart: number
    let rawEnd: number
    let providerSpan: ProviderSpan | null = null
    let rawUnit: OffsetUnit = 'utf16'
    if (!spans || (!matchedValues && spans[index] === null)) {
      // 缺 span 時也要檢查整個實送 state，包裝中重複相同文字不能冒充素材引文。
      const first = state.indexOf(value)
      if (first < 0) {
        reject(index, 'not_found')
        continue
      }
      if (state.indexOf(value, first + 1) >= 0) {
        reject(index, 'ambiguous_value')
        continue
      }
      if (first < sourceStart || first + value.length > sourceEnd) {
        reject(index, 'outside_source')
        continue
      }
      rawStart = first - sourceStart
      rawEnd = rawStart + value.length
      // 字串搜尋一樣不得切斷 surrogate。
      if (toUtf16(state, map, sourceStart + rawStart, 'utf16') === null || toUtf16(state, map, sourceStart + rawEnd, 'utf16') === null) {
        reject(index, 'invalid_value')
        continue
      }
    } else {
      const span: unknown = spans[index]
      if (!Array.isArray(span) || span.length !== 2 || !Number.isSafeInteger(span[0]) || !Number.isSafeInteger(span[1]) || span[0] < 0 || span[1] <= span[0]) {
        reject(index, 'invalid_spans')
        continue
      }
      const matches: Array<{ unit: OffsetUnit; start: number; end: number }> = []
      for (const unit of units) {
        const start = toUtf16(state, map, span[0], unit)
        const end = toUtf16(state, map, span[1], unit)
        if (start !== null && end !== null && end > start) {
          const text = state.slice(start, end)
          if (matchedValues ? matchedValues.has(text) : text === value) matches.push({ unit, start, end })
        }
      }
      if (!matches.length) {
        reject(index, 'span_value_conflict')
        continue
      }
      const first = matches[0]
      if (matches.some(match => match.start !== first.start || match.end !== first.end)) {
        reject(index, 'ambiguous_span')
        continue
      }
      if (first.start < sourceStart || first.end > sourceEnd) {
        reject(index, 'outside_source')
        continue
      }
      if (matchedValues) {
        value = state.slice(first.start, first.end)
        matchedValues.set(value, true)
      }
      rawStart = first.start - sourceStart
      rawEnd = first.end - sourceStart
      // 無法區別的單位不冒充 provider 單位；原文範圍改以已知 UTF-16 表示。
      rawUnit = matches.length === 1 ? first.unit : 'utf16'
      providerSpan = { start: span[0], end: span[1], unit: matches.length === 1 ? first.unit : null, possible_units: matches.map(match => match.unit) }
    }
    const rawSpan = { start: fromUtf16(content, rawStart, rawUnit), end: fromUtf16(content, rawEnd, rawUnit), unit: rawUnit }
    anchors.push({ index, span: { start: rawStart, end: rawEnd, unit: 'utf16' }, raw_span: rawSpan, provider_span: providerSpan })
    const expanded = expand(content, rawStart, rawEnd)
    // 多個詞級錨點落在同一完整單位時，只交付一筆，不把碎片放大成多個主張。
    const id = `e:${material_id}:${expanded.start}:${expanded.end}`
    if (seen.has(id)) {
      duplicates++
      continue
    }
    seen.add(id)
    evidence.push({
      id,
      material_id,
      quote: content.slice(expanded.start, expanded.end),
      raw_quote: content.slice(rawStart, rawEnd),
      raw_span: rawSpan,
      expanded_span: expanded,
      provider_span: providerSpan,
    })
  }
  if (matchedValues) {
    // 此相容路徑必須整份成立，不能悄悄丟掉無效座標或未覆蓋片段後交付 partial。
    if (rejected.length) return { status: 'failed', evidence: [], rejected, duplicates: 0, state_mapping: stateMapping, anchors: [], anchor_index_kind: 'span' }
    for (const matched of matchedValues.values()) {
      if (!matched) return { ...failed('invalid_spans'), state_mapping: stateMapping }
    }
  }
  return { status: rejected.length ? (evidence.length ? 'partial' : 'failed') : 'complete', evidence, rejected, duplicates, state_mapping: stateMapping, anchors, anchor_index_kind: matchedValues ? 'span' : 'value' }
}
