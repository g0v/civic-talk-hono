import type { OffsetUnit, Span } from './evidence'

export const units: readonly OffsetUnit[] = ['utf16', 'unicode', 'utf8']

export interface CoordinateMap {
  readonly unicode: number[]
  readonly utf8: Map<number, number>
}

// 僅映射完整 Unicode scalar 的邊界。
export function coordinates(text: string): CoordinateMap | null {
  const unicode = [0]
  const utf8 = new Map<number, number>([[0, 0]])
  let position = 0
  let bytes = 0
  while (position < text.length) {
    const code = text.codePointAt(position)
    if (code === undefined || (code >= 0xd800 && code <= 0xdfff)) return null
    position += code > 0xffff ? 2 : 1
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    unicode.push(position)
    utf8.set(bytes, position)
  }
  return { unicode, utf8 }
}

export function toUtf16(text: string, map: CoordinateMap, offset: number, unit: OffsetUnit): number | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null
  if (unit === 'unicode') return map.unicode[offset] ?? null
  if (unit === 'utf8') return map.utf8.get(offset) ?? null
  if (offset > text.length) return null
  if (offset > 0 && offset < text.length && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff) return null
  return offset
}

export function fromUtf16(text: string, offset: number, unit: OffsetUnit): number {
  if (unit === 'utf16') return offset
  const prefix = text.slice(0, offset)
  return unit === 'unicode' ? Array.from(prefix).length : new TextEncoder().encode(prefix).length
}

export function sliceEvidenceSpan(content: string, span: Span): string | null {
  const map = coordinates(content)
  if (!map || !units.includes(span.unit)) return null
  const start = toUtf16(content, map, span.start, span.unit)
  const end = toUtf16(content, map, span.end, span.unit)
  return start === null || end === null || end <= start ? null : content.slice(start, end)
}
