import { describe, expect, it } from 'vite-plus/test'
import { buildEvidenceCandidates } from '../ai/evidenceCandidates'
import { expandEvidenceCandidateRanges } from '../ai/evidence'

const title = '自學團體籲補助國中小自學生 全教總：對「偽自學」產生巨大誘因'

describe('空白分隔的發言者展句', () => {
  it('議題7反方 raw 補回全教總歸屬，但不越過空白吞入支持方', async () => {
    const result = await buildEvidenceCandidates(1, title, [{ index: 0, span: { start: 18, end: 30, unit: 'utf16' } }])

    expect(result.claims.map(c => ({ text: c.text, span: c.span }))).toEqual([
      { text: '全教總：對「偽自學」產生巨大誘因', span: { start: 14, end: 30, unit: 'utf16' } },
    ])
    expect(result.contexts.map(c => c.text)).toEqual([title])
    expect(result.raw.map(r => ({ index: r.index, text: r.text, span: r.span }))).toEqual([
      { index: 0, text: '對「偽自學」產生巨大誘因', span: { start: 18, end: 30, unit: 'utf16' } },
    ])
  })

  it('標題兩方都選到時，兩個 claim 共用語境仍分別保留', async () => {
    const result = await buildEvidenceCandidates(1, title, [
      { index: 0, span: { start: 0, end: 13, unit: 'utf16' } },
      { index: 1, span: { start: 14, end: 30, unit: 'utf16' } },
    ])

    expect(result.claims.map(c => c.text)).toEqual(['自學團體籲補助國中小自學生', '全教總：對「偽自學」產生巨大誘因'])
    expect(result.contexts.map(c => c.text)).toEqual([title])
    expect(result.raw.map(r => result.claims.find(c => c.id === r.claim_id)?.text)).toEqual([
      '自學團體籲補助國中小自學生', '全教總：對「偽自學」產生巨大誘因',
    ])
  })

  it.each([
    { name: '英文詞間空白', source: 'Teachers oppose subsidies unless funding is protected.', raw: 'oppose' },
    { name: '引號內的發言標籤', source: '協會表示「甲方籲補助 全教總：有疑慮」。', raw: '有疑慮' },
    { name: '前置必要條件', source: '只有先完成評估 協會：才支持補助。', raw: '支持' },
    { name: '後置必要條件標籤', source: '協會支持補助 前提：先完成評估。', raw: '支持' },
    { name: '發言者冒號後空白', source: '全教總： 對「偽自學」產生巨大誘因', raw: '對「偽自學」產生巨大誘因' },
    { name: 'raw 已跨兩方', source: title, raw: title },
  ])('$name 不因空白裁掉已選內容或必要歸屬', ({ source, raw }) => {
    const start = source.indexOf(raw)

    const ranges = expandEvidenceCandidateRanges(source, start, start + raw.length)

    expect(source.slice(ranges.claim.start, ranges.claim.end)).toBe(source)
    expect(source.slice(ranges.context.start, ranges.context.end)).toBe(source)
  })
})
