export function isTerminal(text: string, index: number): boolean {
  const char = text[index]
  if (char === '\r' || char === '\n' || char === '。' || char === '！' || char === '？' || char === '｡' || char === '．' || char === '!' || char === '?') return true
  // 十進位數值中的點不是句界。
  return char === '.' && !(index > 0 && index + 1 < text.length && /[0-9]/.test(text[index - 1]) && /[0-9]/.test(text[index + 1]))
}

export const closing = '”’」』）】》〉〕)]}"\''
import type { Span } from './evidence'


/** 舊E0句界保留供歷史格式與回歸使用。 */
export function expandSentence(content: string, rawStart: number, rawEnd: number): Span<'utf16'> {
  let start = rawStart
  while (start > 0 && !isTerminal(content, start - 1)) start--
  if (start > 0 && content[start - 1] !== '\r' && content[start - 1] !== '\n') {
    while (start < rawStart && closing.includes(content[start])) start++
  }
  while (start < rawStart && (content[start] === ' ' || content[start] === '\t')) start++
  let end = rawEnd
  let terminalIncluded = end > 0 && isTerminal(content, end - 1)
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
