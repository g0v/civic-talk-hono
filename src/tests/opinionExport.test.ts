import { describe, expect, it } from 'vite-plus/test'
import { formatCommentsCsv, polisDatetime, toCommentsCsvRows } from '../opinions/export'

describe('comments.csv formatter', () => {
  it('uses UTC pol.is datetime, stable known authors, unique legacy authors, and escaping', () => {
    const rows = toCommentsCsvRows([
      { id: 10, summary: 'known first', created_at: '2026-09-01 00:00:00', author_id: 'author-a', agrees: 2, disagrees: 1 },
      { id: 11, summary: 'legacy, "quoted"\r\nline\rold mac\nlast line', created_at: '2026-09-01 00:01:02', author_id: null, agrees: 0, disagrees: 0 },
      { id: 12, summary: 'known again', created_at: '2026-09-01 00:02:03', author_id: 'author-a', agrees: 3, disagrees: 0 },
      { id: 13, summary: 'legacy again', created_at: '2026-09-01 00:03:04', author_id: null, agrees: 1, disagrees: 2 },
    ])

    expect(rows.map(row => row.authorId)).toEqual([1, 2, 1, 3])
    expect(rows.every(row => row.authorId !== 0)).toBe(true)
    expect(polisDatetime('2026-09-01 00:01:02')).toBe('Tue Sep 01 2026 00:01:02 GMT+0000 (Coordinated Universal Time)')

    expect(formatCommentsCsv(rows)).toBe(
      'timestamp,datetime,comment-id,author-id,agrees,disagrees,moderated,comment-body\n' +
        '1788220800,Tue Sep 01 2026 00:00:00 GMT+0000 (Coordinated Universal Time),10,1,2,1,1,"known first"\n' +
        '1788220862,Tue Sep 01 2026 00:01:02 GMT+0000 (Coordinated Universal Time),11,2,0,0,1,"legacy, ""quoted""\\nline\\nold mac\\nlast line"\n' +
        '1788220923,Tue Sep 01 2026 00:02:03 GMT+0000 (Coordinated Universal Time),12,1,3,0,1,"known again"\n' +
        '1788220984,Tue Sep 01 2026 00:03:04 GMT+0000 (Coordinated Universal Time),13,3,1,2,1,"legacy again"\n'
    )
  })

  it('keeps every exported opinion on exactly one physical CSV line', () => {
    const rows = toCommentsCsvRows([
      { id: 1, summary: 'first paragraph\n\nsecond paragraph', created_at: '2026-09-01 00:00:00', author_id: 'author-a', agrees: 0, disagrees: 0 },
      { id: 2, summary: 'single line', created_at: '2026-09-01 00:01:00', author_id: 'author-b', agrees: 0, disagrees: 0 },
    ])

    const csv = formatCommentsCsv(rows)

    expect(csv.trimEnd().split('\n')).toHaveLength(3)
    expect(csv).toContain('"first paragraph\\n\\nsecond paragraph"')
  })
})
