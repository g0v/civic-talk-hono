import type { Span } from './evidence'
import { isTerminal, closing } from './evidenceBoundaries'

/** E1句界；前置條件與 expandSentence 相同，由共用驗證器先接受錨點。 */
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
  const spaces: number[] = []
  const opening = '“‘「『（【《〈〔([{'
  const paired = '”’」』）】》〉〕)]}'
  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    // 詞內撇號不是引號，避免縮約詞改變後續直引號方向。
    if ((char === "'" || char === '’') && /[\p{L}\p{N}]$/u.test(content.slice(Math.max(0, index - 2), index)) && /^[\p{L}\p{N}]/u.test(content.slice(index + 1, index + 3))) continue
    if (!stack.length && (char === '；' || char === ';')) semicolons.push(index)
    if (!stack.length && (char === ' ' || char === '\t') && content[index - 1] !== ' ' && content[index - 1] !== '\t') spaces.push(index)
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
    const dependency = /(?:若|如果|假如|假設|除非|因為|因此|只有|只要|僅在|唯有|前提|條件)/u
    const independent = (text: string) => {
      // 只認明示角色／機構詞尾；未知主語不因有任意文字前綴就視為獨立。
      const statement = text.trimStart().match(/^([\p{L}\p{N} \t]+方|[\p{L}\p{N} \t]*(?:協會|政府|市府))(?:不)?(?:支持|反對)[ \t]*([\p{L}\p{N}]+)/u)
      return (
        statement !== null &&
        !/^(?:支持|反對|但|然而|而|並|且|也|仍|不|僅|只|對|在|針對|關於|至於|比方)/u.test(statement[1]) &&
        !dependency.test(statement[1]) &&
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
    // 空白先作候選：只採引號外的中文標籤冒號結構，不將每個詞間空白硬切。
    for (const cut of spaces) {
      if (cut <= start || cut >= end) continue
      let next = cut
      while (content[next] === ' ' || content[next] === '\t') next++
      const label = content.slice(next, end).match(/^([\p{Script=Han}]{2,})[:：]/u)
      if (!label || dependency.test(label[1]) || dependency.test(content.slice(start, cut))) continue
      if (next <= rawStart) start = next
      else if (cut >= rawEnd) {
        end = cut
        break
      }
    }
  }
  return { claim: { start, end, unit: 'utf16' }, context }
}
