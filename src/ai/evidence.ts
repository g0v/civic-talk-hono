export const EVIDENCE_ALGORITHM_VERSION = 'evidence-1' as const
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
  quote: string
  raw_quote: string
  raw_span: Span
  expanded_span: Span<'utf16'>
  // 原始 offset 以送交 provider 的 state 為座標；raw_span 則以素材原文為座標。
  provider_span?: ProviderSpan | null
}

export interface EvidenceRejection {
  index: number | null
  reason: 'invalid_input' | 'invalid_state_mapping' | 'invalid_unicode' | 'invalid_response' | 'truncated' | 'state_text_mismatch' | 'invalid_answer' | 'invalid_spans' | 'invalid_value' | 'not_found' | 'ambiguous_value' | 'span_value_conflict' | 'ambiguous_span' | 'outside_source'
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

const units: OffsetUnit[] = ['utf16', 'unicode', 'utf8']

interface CoordinateMap {
  unicode: number[]
  utf8: Map<number, number>
}

// 僅映射完整 Unicode scalar 的邊界，避免將 surrogate 或 UTF-8 字節切半。
function coordinates(text: string): CoordinateMap | null {
  const unicode = [0]
  const utf8 = new Map<number, number>([[0, 0]])
  let position = 0
  let bytes = 0
  while (position < text.length) {
    const code = text.codePointAt(position)!
    if (code >= 0xd800 && code <= 0xdfff) return null
    position += code > 0xffff ? 2 : 1
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    unicode.push(position)
    utf8.set(bytes, position)
  }
  return { unicode, utf8 }
}

function toUtf16(text: string, map: CoordinateMap, offset: number, unit: OffsetUnit): number | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null
  if (unit === 'unicode') return map.unicode[offset] ?? null
  if (unit === 'utf8') return map.utf8.get(offset) ?? null
  if (offset > text.length) return null
  // UTF-16 座標仍須落在完整字元邊界。
  if (offset > 0 && offset < text.length && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff) return null
  return offset
}

function fromUtf16(text: string, offset: number, unit: OffsetUnit): number {
  if (unit === 'utf16') return offset
  const prefix = text.slice(0, offset)
  return unit === 'unicode' ? Array.from(prefix).length : new TextEncoder().encode(prefix).length
}

/** 用原文座標切片；無效邊界或超出原文時回傳 null。 */
export function sliceEvidenceSpan(content: string, span: Span): string | null {
  const map = coordinates(content)
  if (!map || !units.includes(span.unit)) return null
  const start = toUtf16(content, map, span.start, span.unit)
  const end = toUtf16(content, map, span.end, span.unit)
  return start === null || end === null || end <= start ? null : content.slice(start, end)
}

function isTerminal(text: string, index: number): boolean {
  const char = text[index]
  if (char === '\r' || char === '\n' || char === '。' || char === '！' || char === '？' || char === '｡' || char === '．' || char === '!' || char === '?') return true
  // 十進位數值中的點不是句界。
  return char === '.' && !(index > 0 && index + 1 < text.length && /[0-9]/.test(text[index - 1]) && /[0-9]/.test(text[index + 1]))
}

const closing = '”’」』）】》〉〕)]}"\''

/** 句界規則版本同 EVIDENCE_ALGORITHM_VERSION；切片始終保留未正規化原文。 */
export function expandSentence(content: string, rawStart: number, rawEnd: number): Span<'utf16'> {
  let start = rawStart
  while (start > 0 && !isTerminal(content, start - 1)) start--
  // 只有真正位於前一句標點之後，才略過閉合標點；行首或原文開頭的引號可能是新句開頭。
  if (start > 0 && content[start - 1] !== '\r' && content[start - 1] !== '\n') {
    while (start < rawStart && closing.includes(content[start])) start++
  }
  while (start < rawStart && (content[start] === ' ' || content[start] === '\t')) start++

  let end = rawEnd
  let terminalIncluded = end > 0 && isTerminal(content, end - 1)
  // 原始片段若已包含句尾引號，不應擴展至下一句。
  if (!terminalIncluded) {
    let previous = end - 1
    while (previous >= rawStart && closing.includes(content[previous])) previous--
    terminalIncluded = previous >= rawStart && isTerminal(content, previous)
  }
  if (!terminalIncluded) {
    while (end < content.length && !isTerminal(content, end)) end++
    if (end < content.length && content[end] !== '\r' && content[end] !== '\n') end++
  }
  if (end > 0 && content[end - 1] !== '\r' && content[end - 1] !== '\n') {
    while (end < content.length && (closing.includes(content[end]) || (isTerminal(content, end) && content[end] !== '\r' && content[end] !== '\n'))) end++
  }
  return { start, end, unit: 'utf16' }
}

function failed(reason: EvidenceRejection['reason']): EvidenceExtraction {
  return { status: 'failed', evidence: [], rejected: [{ index: null, reason }], duplicates: 0, state_mapping: null }
}

/** 只接受唯一可回查該素材原文的 list value；不以 guess 或信心補造資料。 */
export function extractClairicEvidence(input: ClairicEvidenceInput): EvidenceExtraction {
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
  if (answer.value === null) return { status: 'complete', evidence: [], rejected: [], duplicates: 0, state_mapping: stateMapping }
  if (!Array.isArray(answer.value)) return { ...failed('invalid_answer'), state_mapping: stateMapping }
  const values = answer.value
  // 提供 spans 時，不能將缺漏、格式錯誤或錯位當成缺 span 退回字串搜尋。
  if (answer.spans !== undefined && (!Array.isArray(answer.spans) || answer.spans.length !== values.length)) return { ...failed('invalid_spans'), state_mapping: stateMapping }
  const spans = answer.spans as unknown[] | undefined
  const evidence: Evidence[] = []
  const rejected: EvidenceRejection[] = []
  const seen = new Set<string>()
  let duplicates = 0
  const reject = (index: number, reason: EvidenceRejection['reason']) => rejected.push({ index, reason })

  for (let index = 0; index < values.length; index++) {
    const value: unknown = values[index]
    if (typeof value !== 'string' || !value.length) {
      reject(index, 'invalid_value')
      continue
    }
    let rawStart: number
    let rawEnd: number
    let providerSpan: ProviderSpan | null = null
    let rawUnit: OffsetUnit = 'utf16'
    if (!spans || spans[index] === null) {
      // 缺 span 時也要檢查整個實送 state，包裝中重複相同文字不能冒充素材引文。
      const first = state.indexOf(value)
      if (first < 0) { reject(index, 'not_found'); continue }
      if (state.indexOf(value, first + 1) >= 0) { reject(index, 'ambiguous_value'); continue }
      if (first < sourceStart || first + value.length > sourceEnd) { reject(index, 'outside_source'); continue }
      rawStart = first - sourceStart
      rawEnd = rawStart + value.length
      // 字串搜尋一樣不得切斷 surrogate。
      if (toUtf16(state, map, sourceStart + rawStart, 'utf16') === null || toUtf16(state, map, sourceStart + rawEnd, 'utf16') === null) { reject(index, 'invalid_value'); continue }
    } else {
      const span: unknown = spans[index]
      if (!Array.isArray(span) || span.length !== 2 || !Number.isSafeInteger(span[0]) || !Number.isSafeInteger(span[1]) || span[0] < 0 || span[1] <= span[0]) { reject(index, 'invalid_spans'); continue }
      const matches: Array<{ unit: OffsetUnit; start: number; end: number }> = []
      for (const unit of units) {
        const start = toUtf16(state, map, span[0], unit)
        const end = toUtf16(state, map, span[1], unit)
        if (start !== null && end !== null && end > start && state.slice(start, end) === value) matches.push({ unit, start, end })
      }
      if (!matches.length) { reject(index, 'span_value_conflict'); continue }
      const first = matches[0]
      if (matches.some(match => match.start !== first.start || match.end !== first.end)) { reject(index, 'ambiguous_span'); continue }
      if (first.start < sourceStart || first.end > sourceEnd) { reject(index, 'outside_source'); continue }
      rawStart = first.start - sourceStart
      rawEnd = first.end - sourceStart
      // 無法區別的單位不冒充 provider 單位；原文範圍改以已知 UTF-16 表示。
      rawUnit = matches.length === 1 ? first.unit : 'utf16'
      providerSpan = { start: span[0], end: span[1], unit: matches.length === 1 ? first.unit : null, possible_units: matches.map(match => match.unit) }
    }
    const expanded = expandSentence(content, rawStart, rawEnd)
    const id = `e:${material_id}:${expanded.start}:${expanded.end}`
    if (seen.has(id)) { duplicates++; continue }
    seen.add(id)
    evidence.push({
      id,
      material_id,
      quote: content.slice(expanded.start, expanded.end),
      raw_quote: content.slice(rawStart, rawEnd),
      raw_span: { start: fromUtf16(content, rawStart, rawUnit), end: fromUtf16(content, rawEnd, rawUnit), unit: rawUnit },
      expanded_span: expanded,
      provider_span: providerSpan,
    })
  }
  return { status: rejected.length ? (evidence.length ? 'partial' : 'failed') : 'complete', evidence, rejected, duplicates, state_mapping: stateMapping }
}
