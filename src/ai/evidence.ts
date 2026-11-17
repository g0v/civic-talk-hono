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
  if (offset > 0 && offset < text.length && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff)
    return null
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

/** 將已驗證錨點展開至完整原文句界，跨句選取保留原範圍，不拼接或改寫。 */
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

/** 離線句界候選；前置條件與 expandSentence 相同，不接正式提取流程。 */
export function expandSentenceCandidate(content: string, rawStart: number, rawEnd: number): Span<'utf16'> {
  return expandEvidenceCandidateRanges(content, rawStart, rawEnd).claim
}

/** 同次掃描保留必要語境與最小候選；不以舊 E0 展句代替 context。 */
export function expandEvidenceCandidateRanges(content: string, rawStart: number, rawEnd: number): {
  readonly claim: Span<'utf16'>
  readonly context: Span<'utf16'>
} {
  // 只辨識連續帶點大寫首字母；縮寫恰好位於句尾的語法歧義仍待人工審閱。
  const acronymDots = new Set<number>()
  for (const match of content.matchAll(/\b(?:[A-Z]\.){2,}/g)) {
    for (let offset = 1; offset < match[0].length; offset += 2) acronymDots.add(match.index + offset)
  }
  const terminal = (index: number) => isTerminal(content, index) && !acronymDots.has(index)
  const closingAt = new Set<number>()
  const openingAt = new Map<number, number>()
  const stack: { readonly close: string; readonly start: number }[] = []
  const semicolons: number[] = []
  const opening = '“‘「『（【《〈〔([{'
  const paired = '”’」』）】》〉〕)]}'
  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    // 詞內撇號不是引號，避免縮約詞改變後續直引號方向。
    if ((char === "'" || char === '’') && /[\p{L}\p{N}]$/u.test(content.slice(Math.max(0, index - 2), index)) && /^[\p{L}\p{N}]/u.test(content.slice(index + 1, index + 3))) continue
    if (!stack.length && (char === '；' || char === ';')) semicolons.push(index)
    if (char === '"' || char === "'") {
      const pair = stack.at(-1)
      if (pair?.close === char) {
        closingAt.add(index)
        openingAt.set(index, pair.start)
        stack.pop()
      } else if (char !== "'" || !/[\p{L}\p{N}]$/u.test(content.slice(Math.max(0, index - 2), index))) {
        stack.push({ close: char, start: index })
      }
    } else {
      const pairIndex = opening.indexOf(char)
      if (pairIndex >= 0) stack.push({ close: paired[pairIndex], start: index })
      else if (closing.includes(char)) {
        closingAt.add(index)
        const pair = stack.at(-1)
        if (pair?.close === char) {
          openingAt.set(index, pair.start)
          stack.pop()
        }
      }
    }
  }

  // 只限制新增展開，不裁切 raw 已明選的跨段範圍；CRLF 是一個換行。
  let paragraphStart = 0
  let paragraphEnd = content.length
  for (const match of content.matchAll(/(?:\r\n|\r(?!\n)|(?<!\r)\n)[ \t]*(?:\r\n|\r(?!\n)|(?<!\r)\n)/gu)) {
    const breakEnd = match.index + match[0].length
    if (breakEnd <= rawStart) {
      paragraphStart = breakEnd
      continue
    }
    if (match.index <= rawStart) paragraphStart = rawStart
    if (match.index >= rawEnd) {
      paragraphEnd = match.index
      break
    }
    if (breakEnd >= rawEnd) {
      paragraphEnd = rawEnd
      break
    }
  }
  const startAt = (anchor: number) => {
    let start = anchor
    while (start > paragraphStart && !terminal(start - 1)) start--
    if (start > 0 && content[start - 1] !== '\r' && content[start - 1] !== '\n') {
      while (start < anchor && closingAt.has(start)) start++
    }
    while (start < anchor && (content[start] === ' ' || content[start] === '\t')) start++
    return start
  }
  // 從 raw 右界向外展開，已選跨句範圍與明示條件一律保留。
  const endAt = (anchor: number, end: number) => {
    let previous = end - 1
    while (previous >= anchor && closingAt.has(previous)) previous--
    if (previous < anchor || !terminal(previous)) {
      while (end < paragraphEnd && !terminal(end)) end++
      if (end < paragraphEnd && content[end] !== '\r' && content[end] !== '\n') end++
    }
    if (end > 0 && content[end - 1] !== '\r' && content[end - 1] !== '\n') {
      while (end < paragraphEnd && (closingAt.has(end) || (terminal(end) && content[end] !== '\r' && content[end] !== '\n'))) end++
    }
    return end
  }

  // 依附可跨一個換行，但不跨空白段；原始空白仍完整留在回傳範圍。
  const nextAt = (position: number) => {
    while (content[position] === ' ' || content[position] === '\t') position++
    if (content[position] === '\r') {
      position++
      if (content[position] === '\n') position++
    } else if (content[position] === '\n') position++
    while (content[position] === ' ' || content[position] === '\t') position++
    return position
  }
  const attribution = /^(?:是|為|係)[^。！？!?\r\n]*的(?:主張|立場|看法|意見|說法)/u
  const condition = /^(?:(?:但|惟)[，,]?[ \t]*)?(?:前提是|條件是)/u
  const unitStart = startAt(rawStart)
  const unitEnd = endAt(rawStart, rawEnd)
  let start = unitStart
  let end = unitEnd
  // 只補明示的局部依附；傳遞保留仍可能是複合候選，並不表示已原子化或語義核可。
  for (;;) {
    const beforeStart = start
    const beforeEnd = end
    for (const [close, open] of openingAt) {
      if (open < paragraphStart || close >= paragraphEnd) continue
      const after = nextAt(close + 1)
      if (after >= paragraphEnd) continue
      const attributedEnd = endAt(after, after)
      if (!attribution.test(content.slice(after, attributedEnd))) continue
      if (start < attributedEnd && end > open) {
        start = Math.min(start, open)
        end = Math.max(end, attributedEnd)
      }
    }
    const current = nextAt(start)
    if (condition.test(content.slice(current))) {
      let previous = current
      while (content[previous - 1] === ' ' || content[previous - 1] === '\t') previous--
      if (content[previous - 1] === '\n') {
        previous--
        if (content[previous - 1] === '\r') previous--
      } else if (content[previous - 1] === '\r') previous--
      while (content[previous - 1] === ' ' || content[previous - 1] === '\t') previous--
      if (previous > 0 && content[previous - 1] !== '\r' && content[previous - 1] !== '\n') {
        let anchor = previous - 1
        while (anchor > 0 && closingAt.has(anchor)) anchor--
        start = Math.min(start, startAt(Math.max(paragraphStart, anchor)))
      }
    }
    let boundary = end
    while (boundary > start && (content[boundary - 1] === ' ' || content[boundary - 1] === '\t' || content[boundary - 1] === '\r' || content[boundary - 1] === '\n')) boundary--
    const next = nextAt(boundary)
    const match = content.slice(next).match(condition)
    if (match && next >= end && next < paragraphEnd) end = endAt(next, next + match[0].length)
    if (start === beforeStart && end === beforeEnd) break
  }
  const context: Span<'utf16'> = { start, end, unit: 'utf16' }
  // 必要依附已擴張時保留複合原文；不以新切點抵銷先前補回的條件或歸屬。
  if (start === unitStart && end === unitEnd) {
    const reference = /^(?:此|該|這|那|其|它|他|她|前|後|上|下|以|如|所|同|相同|另|原|先)|(?:前者|後者|上述|下述|前述|後述)/u
    const independent = (text: string) => {
      // 只認明示角色／機構詞尾；未知主語不因有任意文字前綴就視為獨立。
      const statement = text.trimStart().match(/^([\p{L}\p{N} \t]+方|[\p{L}\p{N} \t]*(?:協會|政府|市府))(?:不)?(?:支持|反對)[ \t]*([\p{L}\p{N}]+)/u)
      return (
        statement !== null &&
        !/^(?:支持|反對|但|然而|而|並|且|也|仍|不|僅|只|對|在|針對|關於|至於|比方)/u.test(statement[1]) &&
        !/(?:若|如果|假如|假設|除非|因為|因此|只有|只要|僅在|唯有|前提|條件)/u.test(statement[1]) &&
        !reference.test(statement[1]) &&
        !reference.test(statement[2]) &&
        !/(?:是|為)(?:必要)?(?:前提|條件)|(?:前提|條件)是[ \t]*$/u.test(text)
      )
    }
    const cuts = semicolons.filter(position => position >= unitStart && position < unitEnd)
    for (const [index, cut] of cuts.entries()) {
      const previous = index === 0 ? unitStart : cuts[index - 1] + 1
      const next = cuts[index + 1] ?? unitEnd
      if (!independent(content.slice(previous, cut)) || !independent(content.slice(cut + 1, next))) continue
      if (cut < rawStart) {
        let boundary = cut + 1
        while (boundary < rawStart && /\s/u.test(content[boundary])) boundary++
        start = Math.max(start, boundary)
      } else if (cut >= rawEnd) {
        let boundary = cut
        while (boundary > rawEnd && /\s/u.test(content[boundary - 1])) boundary--
        end = Math.min(end, boundary)
        break
      }
    }
  }
  return { claim: { start, end, unit: 'utf16' }, context }
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
    const expanded = expandSentence(content, rawStart, rawEnd)
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
      raw_span: { start: fromUtf16(content, rawStart, rawUnit), end: fromUtf16(content, rawEnd, rawUnit), unit: rawUnit },
      expanded_span: expanded,
      provider_span: providerSpan,
    })
  }
  if (matchedValues) {
    // 此相容路徑必須整份成立，不能悄悄丟掉無效座標或未覆蓋片段後交付 partial。
    if (rejected.length) return { status: 'failed', evidence: [], rejected, duplicates: 0, state_mapping: stateMapping }
    for (const matched of matchedValues.values()) {
      if (!matched) return { ...failed('invalid_spans'), state_mapping: stateMapping }
    }
  }
  return { status: rejected.length ? (evidence.length ? 'partial' : 'failed') : 'complete', evidence, rejected, duplicates, state_mapping: stateMapping }
}
