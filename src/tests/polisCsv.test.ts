import { describe, expect, it } from 'vite-plus/test'
import { createParticipantIndex, csvQuote, formatCommentsCsv, formatVotesCsv, moderatedFlag, polisDatetime, POLIS_COMMENTS_HEADER, sqliteToMs, VOTES_HEADER } from '../export/polisCsv'

describe('sqliteToMs', () => {
  it('把沒有時區標記的 SQLite DATETIME 當成 UTC', () => {
    // 若被當成 UTC+8 的當地時間，結果會差 8 小時（28800000 毫秒）
    expect(sqliteToMs('2026-01-02 03:04:05')).toBe(Date.UTC(2026, 0, 2, 3, 4, 5))
  })

  it('已經帶 Z 或時區位移的字串不再重複補 Z', () => {
    expect(sqliteToMs('2026-01-02T03:04:05Z')).toBe(Date.UTC(2026, 0, 2, 3, 4, 5))
    expect(sqliteToMs('2026-01-02T03:04:05+08:00')).toBe(Date.UTC(2026, 0, 1, 19, 4, 5))
  })

  it('null 或解析不出來的值回 0，不讓整份匯出失敗', () => {
    expect(sqliteToMs(null)).toBe(0)
    expect(sqliteToMs('not a date')).toBe(0)
  })
})

describe('polisDatetime', () => {
  it('與 pol.is 匯出檔同形（UTC、固定英文月份與星期）', () => {
    expect(polisDatetime(1760000000000)).toBe('Thu Oct 09 2025 08:53:20 GMT+0000 (Coordinated Universal Time)')
  })
})

describe('moderatedFlag', () => {
  it('abuse_flagged 0 → 1（已核准）、1 → 0（未審）、其餘 → -1（已拒絕）', () => {
    expect(moderatedFlag(0)).toBe(1)
    expect(moderatedFlag(1)).toBe(0)
    expect(moderatedFlag(2)).toBe(-1)
    expect(moderatedFlag(3)).toBe(-1)
  })
})

describe('csvQuote', () => {
  it('內部雙引號寫成兩個雙引號', () => {
    expect(csvQuote('他說 "好"，然後走了')).toBe('"他說 ""好""，然後走了"')
  })

  it('換行與逗號留在引號內，不另外轉義', () => {
    expect(csvQuote('第一行\n第二行, 還有逗號')).toBe('"第一行\n第二行, 還有逗號"')
  })
})

describe('comments.csv', () => {
  it('header 與 pol.is 報告頁匯出的完全一致', () => {
    expect(POLIS_COMMENTS_HEADER).toBe('timestamp,datetime,comment-id,author-id,agrees,disagrees,moderated,comment-body')
    expect(formatCommentsCsv([])).toBe(POLIS_COMMENTS_HEADER + '\n')
  })

  it('逐位元組符合格式（LF 換行、無 BOM、結尾換行、datetime 不加引號）', () => {
    const csv = formatCommentsCsv([
      { id: 1, summary: '我認為應該提供更多參與討論的機會。', created_at: '2025-10-09 08:53:20', abuse_flagged: 0, author_seq: 1, agrees: 12, disagrees: 3 },
      { id: 2, summary: '也應保留實體參與的方式。', created_at: '2025-10-09 08:54:20', abuse_flagged: 1, author_seq: 2, agrees: 8, disagrees: 7 },
    ])

    expect(csv).toBe(
      'timestamp,datetime,comment-id,author-id,agrees,disagrees,moderated,comment-body\n' +
        '1760000000,Thu Oct 09 2025 08:53:20 GMT+0000 (Coordinated Universal Time),1,1,12,3,1,"我認為應該提供更多參與討論的機會。"\n' +
        '1760000060,Thu Oct 09 2025 08:54:20 GMT+0000 (Coordinated Universal Time),2,2,8,7,0,"也應保留實體參與的方式。"\n'
    )
    expect(csv.charCodeAt(0)).not.toBe(0xfeff)
    expect(csv).not.toContain('\r')
  })

  it('沒有作者的舊資料 author-id 為 0，summary 為 null 時輸出空字串', () => {
    const csv = formatCommentsCsv([{ id: 7, summary: null, created_at: '2025-10-09 08:53:20', abuse_flagged: 0, author_seq: 0, agrees: 0, disagrees: 0 }])
    expect(csv).toContain(',7,0,0,0,1,""\n')
  })
})

describe('votes.csv', () => {
  it('header 與匿名代號格式與 pocket-polis 一致', () => {
    expect(VOTES_HEADER).toBe('participant,statement_id,vote,updated_at')
    expect(formatVotesCsv([])).toBe(VOTES_HEADER + '\n')

    const csv = formatVotesCsv([
      { participant_seq: 1, opinion_id: 5, value: 1, updated_at: '2026-01-02 03:04:05' },
      { participant_seq: 2, opinion_id: 5, value: -1, updated_at: '2026-01-02 03:05:06' },
      { participant_seq: 2, opinion_id: 6, value: 0, updated_at: '2026-01-02 03:06:07' },
    ])
    expect(csv).toBe('participant,statement_id,vote,updated_at\n' + 'p1,5,1,2026-01-02T03:04:05.000Z\n' + 'p2,5,-1,2026-01-02T03:05:06.000Z\n' + 'p2,6,0,2026-01-02T03:06:07.000Z\n')
  })
})

describe('createParticipantIndex', () => {
  it('同一個使用者永遠對到同一個序號，序號自 1 起', () => {
    const index = createParticipantIndex()
    expect(index.seqOf('user-a')).toBe(1)
    expect(index.seqOf('user-b')).toBe(2)
    expect(index.seqOf('user-a')).toBe(1)
    expect(index.seqOf('user-c')).toBe(3)
  })

  it('沒有作者（null）固定為 0，且不佔用序號', () => {
    const index = createParticipantIndex()
    expect(index.seqOf(null)).toBe(0)
    expect(index.seqOf('user-a')).toBe(1)
    expect(index.seqOf(null)).toBe(0)
    expect(index.seqOf('user-b')).toBe(2)
  })

  it('不洩漏原始 user.id：輸出只有數字', () => {
    const index = createParticipantIndex()
    expect(typeof index.seqOf('a-very-secret-better-auth-user-id')).toBe('number')
  })
})
