import { describe, expect, it } from 'vite-plus/test'
import { buildEvidenceCandidates, type ValidatedCandidateAnchor } from '../ai/evidenceCandidates'
import { sliceEvidenceSpan } from '../ai/evidence'

const content = '甲方支持弱勢補助；乙方反對普遍補助，除非政府證明不排擠教育預算。'

function anchor(source: string, text: string, index: number): ValidatedCandidateAnchor {
  const start = source.indexOf(text)
  if (start < 0) throw new Error('invalid test fixture')
  return { index, span: { start, end: start + text.length, unit: 'utf16' } }
}

describe('離線 raw／claim／context 對應', () => {
  it('不同 claim 共用 context 仍獨立，同 claim 的多 raw 保留各自索引與定位', async () => {
    const inputs = [anchor(content, '支持弱勢補助', 0), anchor(content, '反對普遍補助', 1), anchor(content, '不排擠教育預算', 2)]

    const result = await buildEvidenceCandidates(1, content, inputs)

    expect(result.claims.map(c => ({ text: c.text, span: c.span }))).toEqual([
      { text: '甲方支持弱勢補助', span: { start: 0, end: 8, unit: 'utf16' } },
      { text: '乙方反對普遍補助，除非政府證明不排擠教育預算。', span: { start: 9, end: 32, unit: 'utf16' } },
    ])
    expect(result.contexts.map(c => ({ text: c.text, span: c.span }))).toEqual([{ text: content, span: { start: 0, end: 32, unit: 'utf16' } }])
    expect(result.raw.map(raw => ({
      index: raw.index,
      span: raw.span,
      text: raw.text,
      claim: result.claims.find(c => c.id === raw.claim_id)?.text,
      context: result.contexts.find(c => c.id === raw.context_id)?.text,
    }))).toEqual([
      { index: 0, span: { start: 2, end: 8, unit: 'utf16' }, text: '支持弱勢補助', claim: '甲方支持弱勢補助', context: content },
      { index: 1, span: { start: 11, end: 17, unit: 'utf16' }, text: '反對普遍補助', claim: '乙方反對普遍補助，除非政府證明不排擠教育預算。', context: content },
      { index: 2, span: { start: 24, end: 31, unit: 'utf16' }, text: '不排擠教育預算', claim: '乙方反對普遍補助，除非政府證明不排擠教育預算。', context: content },
    ])
  })

  it('同 claim 的身分不隨 raw 字詞、原索引或選取集合改變', async () => {
    const full = await buildEvidenceCandidates(1, content, [anchor(content, '支持', 0), anchor(content, '反對', 1)])
    const alternate = await buildEvidenceCandidates(1, content, [anchor(content, '弱勢補助', 7)])

    expect(alternate.claims[0].id).toBe(full.claims[0].id)
    expect(alternate.contexts[0].id).toBe(full.contexts[0].id)
    expect(alternate.raw[0].index).toBe(7)
  })

  it.each([
    { name: '不同素材', material: 2, text: content },
    { name: '來源改版', material: 1, text: content + '後文。' },
  ])('$name 不會與相同範圍的舊 claim／context 身分混用', async ({ material, text }) => {
    const previous = await buildEvidenceCandidates(1, content, [anchor(content, '支持', 0)])
    const next = await buildEvidenceCandidates(material, text, [anchor(text, '支持', 0)])

    expect(next.claims[0].id).not.toBe(previous.claims[0].id)
    expect(next.contexts[0].id).not.toBe(previous.contexts[0].id)
  })

  it('UTF-16 raw 與後置歸屬在 Unicode／CRLF 素材中皆能逐字回查', async () => {
    const source = '前文😀。\r\n「應停建。」是反對者的主張。'
    const expected = '「應停建。」是反對者的主張。'
    const input = anchor(source, '應停建', 4)

    const result = await buildEvidenceCandidates(5, source, [input])

    expect(result.raw[0].span).toEqual(input.span)
    expect(result.raw[0].text).toBe('應停建')
    expect(result.claims.map(c => c.text)).toEqual([expected])
    expect(result.contexts.map(c => c.text)).toEqual([expected])
    for (const passage of [result.raw[0], result.claims[0], result.contexts[0]]) expect(sliceEvidenceSpan(source, passage.span)).toBe(passage.text)
    expect(result.contexts[0].span).toEqual({ start: 7, end: 21, unit: 'utf16' })
  })

  it('沒有已接受 raw 時不從素材自動增加主張或語境', async () => {
    const result = await buildEvidenceCandidates(1, content, [])

    expect({ raw: result.raw, claims: result.claims, contexts: result.contexts }).toEqual({ raw: [], claims: [], contexts: [] })
  })
})
