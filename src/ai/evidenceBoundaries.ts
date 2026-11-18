export function isTerminal(text: string, index: number): boolean {
  const char = text[index]
  if (char === '\r' || char === '\n' || char === '。' || char === '！' || char === '？' || char === '｡' || char === '．' || char === '!' || char === '?') return true
  // 十進位數值中的點不是句界。
  return char === '.' && !(index > 0 && index + 1 < text.length && /[0-9]/.test(text[index - 1]) && /[0-9]/.test(text[index + 1]))
}

export const closing = '”’」』）】》〉〕)]}"\''
